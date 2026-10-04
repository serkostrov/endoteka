# Миграция из RO App (разово)

Выгрузка через Public API v2 → CSV → штатный импортёр Endoteka (`npm run import`).

## 1. Выгрузка

```bash
ROAPP_API_KEY='…' npm run import:roapp -- --out import/data/roapp
```

Файлы появятся в `import/data/roapp/` (каталог в `.gitignore`, там ПДн).

## 2. Импорт в Supabase

Нужны `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` (service role, не anon).

```bash
# Сначала preview
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  npm run import -- preview --dir import/data/roapp --phase full --store supabase --out import/reports/roapp-preview

# Затем запись
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  npm run import -- import --dir import/data/roapp --phase full --store supabase --out import/reports/roapp-import
```

Повторный прогон безопасен: ключи `source_id` / номера заказов / серийники не плодят дубликаты.

### Только категории номенклатуры

Если позиции уже импортированы, а категории были «Запчасти» у всех — после `import:roapp` достаточно пакетного обновления:

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  npm run import:roapp-categories -- --dir import/data/roapp
```

### Состав заказов

```bash
ROAPP_API_KEY=… npm run import:roapp-order-items -- --dir import/data/roapp
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  npm run import:roapp-order-items-sync -- --dir import/data/roapp
```

### Только продажи

После полной выгрузки можно импортировать каталог с `sales.csv` + `sale-lines.csv` (и при необходимости `customers.csv` / `warehouse-items.csv`).

### Приходы (оприходования RO App)

Документы прихода в Endoteka — `receipts.csv` + `receipt-lines.csv` (один документ = несколько строк, как в UI «Приходы»).

Одна команда (API → иначе Excel/CSV из папки → пакетный импорт):

```bash
ROAPP_API_KEY=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  npm run import:roapp-receipts -- --dir import/data/roapp
```

На этом аккаунте warehouse API отвечает 404. Тогда:

1. RO App → Склад → Оприходования → экспорт Excel
2. Положите файл как `import/data/roapp/оприходования.xlsx` (или `roapp-incomes.csv`)
3. Снова `npm run import:roapp-receipts`

Повторный прогон идемпотентен по `source_id` документа.

## Что переносится

| RO App | Endoteka |
|--------|----------|
| Люди + организации (`/contacts/*`) | `customers.csv` |
| Группа/бренд/модель/модификация из asset | `device-models.csv` |
| Заказы | `orders.csv` (+ приборы по серийнику) |
| Каталог товаров | `warehouse-items.csv` + `prices.csv` + `barcodes.csv` (категории из `/catalog/products/categories`) |
| Продажи (`/sales` + `/sales/{id}`) | `sales.csv` + `sale-lines.csv` |
| Оприходования (Excel или API income-transactions) | `receipts.csv` + `receipt-lines.csv` → документы «Приходы» |

## Что API не отдал

- **Остатки / инвентаризации** — в Public API v2 нет. Текущий остаток без истории: Excel → `warehouse-stock.csv`.
- **Оприходования / списания** — методы warehouse `income/outcome-transactions` в документации есть, на аккаунте отвечают 404. Приходы: Excel → `import:roapp-receipts-convert`. Списания: Excel → `write-offs.csv` + `write-off-lines.csv`.
- **Услуги** (`catalog/services`) — в Endoteka это шаблоны работ, не номенклатура.
- Исторические **инвентаризации** как документы не мигрируем: в Endoteka остаток задаётся через `warehouse-stock.csv`, дальше работают штатные инвентаризации.

## Статусы

Маппинг RO → коды Endoteka лежит в `import/data/roapp/export-summary.json` и `README.md` рядом с CSV.

## Безопасность

API-ключ RO App не храните в репозитории. После миграции **перевыпустите** ключ в RO App → Настройки → API.
