import { openPrintWindow } from '@/features/documents/print-documents'

import type { AssemblyDetail, AssemblyPart } from '../services/assembly-service'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatQty(value: number) {
  const rounded = Math.round(value * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

function buildAssemblySheetHtml(assembly: AssemblyDetail, parts: AssemblyPart[]) {
  const rows =
    parts.length === 0
      ? `<tr><td colspan="5" class="empty">Позиции не добавлены</td></tr>`
      : parts
          .map(
            (part, index) => `<tr>
        <td class="col-n">${index + 1}</td>
        <td class="col-name">${escapeHtml(part.name)}</td>
        <td class="col-qty">${escapeHtml(formatQty(part.qtyRequired))}</td>
        <td class="col-qty">${escapeHtml(formatQty(part.qtyCollected))}</td>
        <td class="col-comment">${escapeHtml(part.comment).replace(/\n/g, '<br>')}</td>
      </tr>`,
          )
          .join('')

  const conclusion = assembly.conclusion.trim()
    ? escapeHtml(assembly.conclusion).replace(/\n/g, '<br>')
    : '—'

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Лист сборки запасных частей</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 12mm;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1 {
      margin: 0 0 16px;
      text-align: center;
      font-size: 18px;
      font-weight: 700;
    }
    .meta {
      margin: 0 0 16px;
      border: 1px solid #000;
      padding: 10px 12px;
    }
    .meta-row {
      display: grid;
      grid-template-columns: 11rem 1fr;
      gap: 6px 12px;
      margin: 0 0 6px;
    }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-label { font-weight: 700; }
    .conclusion {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #ccc;
      white-space: pre-wrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid #000;
      padding: 6px 5px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    th {
      text-align: center;
      font-weight: 700;
      font-size: 11px;
    }
    .col-n { width: 6%; text-align: center; }
    .col-name { width: 34%; }
    .col-qty { width: 14%; text-align: center; }
    .col-comment { width: 32%; }
    .empty { text-align: center; color: #444; }
  </style>
</head>
<body>
  <h1>Лист сборки запасных частей</h1>
  <div class="meta">
    <div class="meta-row"><div class="meta-label">Заказ</div><div>${escapeHtml(assembly.number)}</div></div>
    <div class="meta-row"><div class="meta-label">Клиент</div><div>${escapeHtml(assembly.customerName || '—')}</div></div>
    <div class="meta-row"><div class="meta-label">Прибор</div><div>${escapeHtml(assembly.deviceLabel || '—')}</div></div>
    <div class="meta-row"><div class="meta-label">Серийный номер</div><div>${escapeHtml(assembly.serialNumber || '—')}</div></div>
    <div class="conclusion"><span class="meta-label">Заключение диагностики:</span><br>${conclusion}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="col-n">№</th>
        <th class="col-name">Наименование запасной части</th>
        <th class="col-qty">Требуемое</th>
        <th class="col-qty">Собранное</th>
        <th class="col-comment">Комментарий</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <script>
    (function () {
      var printed = false;
      function runPrint() {
        if (printed) return;
        printed = true;
        window.focus();
        window.print();
      }
      window.addEventListener('afterprint', function () {
        window.close();
      });
      if (document.readyState === 'complete') {
        setTimeout(runPrint, 50);
      } else {
        window.addEventListener('load', function () { setTimeout(runPrint, 50); });
      }
    })();
  <\/script>
</body>
</html>`
}

export async function printAssemblySheet(assembly: AssemblyDetail) {
  const popup = openPrintWindow()
  if (!popup) {
    throw new Error('Разрешите всплывающие окна, чтобы напечатать лист сборки.')
  }
  popup.document.open()
  popup.document.write(buildAssemblySheetHtml(assembly, assembly.parts))
  popup.document.close()
  try {
    popup.focus()
  } catch {
    // ignore
  }
}
