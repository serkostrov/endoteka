#!/usr/bin/env python3
"""Импорт поля «Заключение» из Excel в order_diagnostics по номеру заказа.

Использование:
  python3 scripts/import-diagnostics-conclusions.py [/path/to/Заключение.xlsx] [--dry-run]

Правила:
  - матч по orders.number (без учёта регистра лишних пробелов);
  - пустые ячейки Excel не затирают уже сохранённые заключения;
  - текст нормализуется (trim, \\r\\n → \\n, хвостовые пробелы в строках);
  - upsert в order_diagnostics без RPC, чтобы не засорять журнал 981 событием.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    import openpyxl
except ImportError as exc:  # pragma: no cover
    raise SystemExit('Нужен openpyxl: pip install openpyxl') from exc

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = Path.home() / 'Downloads' / 'Заключение.xlsx'
PAGE = 1000
UPSERT_CHUNK = 200


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def normalize_conclusion(value: object) -> str:
    if value is None:
        return ''
    text = str(value).replace('\r\n', '\n').replace('\r', '\n')
    lines = [re.sub(r'[ \t]+$', '', line) for line in text.split('\n')]
    text = '\n'.join(lines).strip()
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text


def normalize_number(value: object) -> str:
    if value is None:
        return ''
    return str(value).strip().upper()


def read_excel(path: Path) -> tuple[dict[str, str], int]:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    header = next(rows, None)
    if not header:
        raise SystemExit('Пустой Excel')

    filled: dict[str, str] = {}
    empty_count = 0
    for row in rows:
        number = normalize_number(row[0] if row else None)
        if not number:
            continue
        conclusion = normalize_conclusion(row[1] if row and len(row) > 1 else None)
        if not conclusion:
            empty_count += 1
            continue
        filled[number] = conclusion
    wb.close()
    return filled, empty_count


class SupabaseRest:
    def __init__(self, base_url: str, service_key: str) -> None:
        self.base = base_url.rstrip('/')
        self.key = service_key

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        body: object | None = None,
        prefer: str | None = None,
    ) -> object:
        url = f'{self.base}/rest/v1/{path}'
        if params:
            url += '?' + urllib.parse.urlencode(params, doseq=True)
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        headers = {
            'apikey': self.key,
            'Authorization': f'Bearer {self.key}',
            'Accept': 'application/json',
        }
        if body is not None:
            headers['Content-Type'] = 'application/json'
        if prefer:
            headers['Prefer'] = prefer
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
                if not raw:
                    return None
                return json.loads(raw.decode('utf-8'))
        except urllib.error.HTTPError as error:
            detail = error.read().decode('utf-8', errors='replace')
            raise RuntimeError(f'{method} {path} → HTTP {error.code}: {detail}') from error

    def fetch_all_orders(self) -> dict[str, str]:
        mapping: dict[str, str] = {}
        offset = 0
        while True:
            rows = self.request(
                'GET',
                'orders',
                params={
                    'select': 'id,number',
                    'order': 'number.asc',
                    'limit': str(PAGE),
                    'offset': str(offset),
                },
                prefer=f'count=exact',
            )
            assert isinstance(rows, list)
            if not rows:
                break
            for row in rows:
                number = normalize_number(row.get('number'))
                order_id = row.get('id')
                if number and order_id:
                    mapping[number] = order_id
            if len(rows) < PAGE:
                break
            offset += PAGE
        return mapping

    def fetch_existing_conclusions(self, order_ids: list[str]) -> dict[str, str]:
        existing: dict[str, str] = {}
        for i in range(0, len(order_ids), 100):
            chunk = order_ids[i : i + 100]
            in_list = '(' + ','.join(chunk) + ')'
            rows = self.request(
                'GET',
                'order_diagnostics',
                params={
                    'select': 'order_id,conclusion',
                    'order_id': f'in.{in_list}',
                },
            )
            assert isinstance(rows, list)
            for row in rows:
                existing[row['order_id']] = normalize_conclusion(row.get('conclusion'))
        return existing

    def upsert_conclusions(self, rows: list[dict[str, str]]) -> None:
        for i in range(0, len(rows), UPSERT_CHUNK):
            chunk = rows[i : i + UPSERT_CHUNK]
            self.request(
                'POST',
                'order_diagnostics',
                body=chunk,
                prefer='resolution=merge-duplicates,return=minimal',
            )


def main() -> int:
    parser = argparse.ArgumentParser(description='Импорт заключений диагностики из Excel')
    parser.add_argument('xlsx', nargs='?', default=str(DEFAULT_XLSX), help='Путь к Excel')
    parser.add_argument('--dry-run', action='store_true', help='Только отчёт, без записи')
    args = parser.parse_args()

    xlsx = Path(args.xlsx).expanduser().resolve()
    if not xlsx.exists():
        print(f'Файл не найден: {xlsx}', file=sys.stderr)
        return 1

    env = {**load_env(ROOT / '.env'), **os.environ}
    base_url = env.get('VITE_SUPABASE_URL') or env.get('SUPABASE_URL')
    service_key = (
        env.get('VITE_SUPABASE_SERVICE_ROLE_KEY')
        or env.get('SUPABASE_SERVICE_ROLE_KEY')
    )
    if not base_url or not service_key:
        print('Нужны VITE_SUPABASE_URL и VITE_SUPABASE_SERVICE_ROLE_KEY', file=sys.stderr)
        return 1

    print(f'Excel: {xlsx}')
    filled, empty_excel = read_excel(xlsx)
    print(f'В Excel с текстом: {len(filled)}, пустых: {empty_excel}')

    api = SupabaseRest(base_url, service_key)
    orders = api.fetch_all_orders()
    print(f'Заказов в БД: {len(orders)}')

    missing: list[str] = []
    planned: list[tuple[str, str, str]] = []  # number, order_id, conclusion
    for number, conclusion in filled.items():
        order_id = orders.get(number)
        if not order_id:
            missing.append(number)
            continue
        planned.append((number, order_id, conclusion))

    existing = api.fetch_existing_conclusions([order_id for _, order_id, _ in planned])
    to_write: list[dict[str, str]] = []
    unchanged = 0
    now = datetime.now(timezone.utc).isoformat()
    for number, order_id, conclusion in planned:
        current = existing.get(order_id, '')
        if current == conclusion:
            unchanged += 1
            continue
        to_write.append(
            {
                'order_id': order_id,
                'conclusion': conclusion,
                'updated_at': now,
            }
        )

    print(f'Найдены в БД: {len(planned)}')
    print(f'Без изменений: {unchanged}')
    print(f'К обновлению/созданию: {len(to_write)}')
    print(f'Не найдены в БД: {len(missing)}')
    if missing[:20]:
        print('  примеры:', ', '.join(missing[:20]))

    if args.dry_run:
        print('Dry-run: запись пропущена')
        return 0

    if to_write:
        api.upsert_conclusions(to_write)
        print(f'Записано: {len(to_write)}')
    else:
        print('Нечего писать')

    report = {
        'xlsx': str(xlsx),
        'filled_excel': len(filled),
        'empty_excel': empty_excel,
        'matched': len(planned),
        'unchanged': unchanged,
        'written': len(to_write),
        'missing': missing,
        'at': now,
    }
    report_path = ROOT / 'scripts' / f'import-diagnostics-conclusions-report-{datetime.now().strftime("%Y%m%d-%H%M%S")}.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Отчёт: {report_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
