/**
 * Плоская выгрузка оприходований RO App (CSV из Excel) → receipts.csv + receipt-lines.csv.
 *
 *   npm run import:roapp-receipts-convert -- \
 *     --in import/data/roapp/roapp-incomes.csv \
 *     --out import/data/roapp
 *
 * В RO App: Склад → Оприходования → экспорт в Excel → «Сохранить как CSV (UTF-8)».
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { parseCsv } from './csv.ts'
import { parseDate, parseNumber } from './normalize.ts'

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function toCsv(headers: string[], rows: Record<string, string>[]) {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? '')).join(','))
  }
  return `${lines.join('\n')}\n`
}

function normHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
}

const FIELD_ALIASES: Record<string, string[]> = {
  number: [
    'number',
    'номер',
    '№',
    'no',
    'doc',
    'document',
    'документ',
    'номер документа',
    'номер оприходования',
    'оприходование №',
    'оприходование no',
    'id',
    'source_id',
  ],
  date: [
    'date',
    'дата',
    'receipt_date',
    'дата документа',
    'дата оприходования',
    'дата создания',
    'created_at',
  ],
  supplier: ['supplier', 'поставщик', 'контрагент', 'supplier_name', 'клиент'],
  supplier_id: ['supplier_id', 'supplier_source_id', 'id поставщика', 'поставщик id'],
  product_id: [
    'product_id',
    'item_source_id',
    'item_id',
    'id товара',
    'товар id',
    'product id',
    'entity_id',
  ],
  product_code: [
    'code',
    'item_code',
    'sku',
    'артикул',
    'код',
    'код товара',
    'внутренний код',
    'article',
    'артикул товара',
  ],
  product_barcode: ['barcode', 'штрихкод', 'штрих-код', 'ean'],
  product_name: ['title', 'name', 'товар', 'наименование', 'название', 'product', 'позиция'],
  quantity: ['quantity', 'qty', 'количество', 'кол-во', 'кол во'],
  price: [
    'purchase_price',
    'price',
    'cost',
    'цена',
    'цена, ₽',
    'цена руб',
    'закупка',
    'себестоимость',
    'цена закупки',
    'стоимость',
  ],
  notes: [
    'notes',
    'note',
    'comment',
    'комментарий',
    'примечание',
    'заметки',
    'накладная №',
    'накладная',
  ],
}

function pickField(row: Record<string, string>, field: string): string {
  const aliases = FIELD_ALIASES[field] ?? []
  const byNorm = new Map<string, string>()
  for (const [key, value] of Object.entries(row)) {
    byNorm.set(normHeader(key), value)
  }
  for (const alias of aliases) {
    const value = byNorm.get(normHeader(alias))
    if (value !== undefined && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return ''
}

async function main() {
  const inPath = path.resolve(arg('--in'))
  const outDir = path.resolve(arg('--out', 'import/data/roapp'))
  if (!arg('--in')) {
    throw new Error('Укажите --in путь к CSV выгрузке оприходований RO App.')
  }

  const text = await readFile(inPath, 'utf8')
  const { headers, rows } = parseCsv(text)
  if (headers.length === 0) {
    throw new Error('CSV пустой или без заголовков.')
  }

  type Doc = {
    sourceId: string
    receiptDate: string
    supplier: string
    supplierSourceId: string
    notes: string
    lines: Array<{
      sourceId: string
      itemSourceId: string
      itemCode: string
      barcode: string
      name: string
      quantity: string
      purchasePrice: string
    }>
  }

  const docs = new Map<string, Doc>()
  let skipped = 0

  for (const [index, raw] of rows.entries()) {
    const number = pickField(raw, 'number')
    const dateRaw = pickField(raw, 'date')
    const receiptDate = parseDate(dateRaw) || dateRaw.slice(0, 10)
    const supplier = pickField(raw, 'supplier') || 'Поставщик RO App'
    const supplierSourceId = pickField(raw, 'supplier_id')
    const productId = pickField(raw, 'product_id')
    const productCode = pickField(raw, 'product_code')
    const productBarcode = pickField(raw, 'product_barcode')
    const productName = pickField(raw, 'product_name')
    const quantity = parseNumber(pickField(raw, 'quantity'))
    const price = parseNumber(pickField(raw, 'price'))
    const notes = pickField(raw, 'notes')

    if (!number && !receiptDate) {
      skipped += 1
      continue
    }
    if (quantity === null || quantity <= 0) {
      skipped += 1
      continue
    }
    if (!productId && !productCode && !productBarcode && !productName) {
      skipped += 1
      continue
    }

    const sourceId = number
      ? `ro-rcp-${number}`
      : `ro-rcp-${receiptDate || 'nodate'}-${supplier}-${index + 1}`

    let doc = docs.get(sourceId)
    if (!doc) {
      doc = {
        sourceId,
        receiptDate: receiptDate || new Date().toISOString().slice(0, 10),
        supplier,
        supplierSourceId: supplierSourceId
          ? supplierSourceId.startsWith('ro-cus-')
            ? supplierSourceId
            : `ro-cus-${supplierSourceId}`
          : '',
        notes,
        lines: [],
      }
      docs.set(sourceId, doc)
    } else {
      if (!doc.notes && notes) {
        doc.notes = notes
      }
      if (doc.supplier === 'Поставщик RO App' && supplier !== 'Поставщик RO App') {
        doc.supplier = supplier
      }
    }

    const lineNo = doc.lines.length + 1
    const itemSourceId = productId
      ? productId.startsWith('ro-item-')
        ? productId
        : `ro-item-${productId}`
      : ''
    doc.lines.push({
      sourceId: `${sourceId}-L${lineNo}`,
      itemSourceId,
      itemCode: productCode || productBarcode || productName,
      quantity: String(quantity),
      purchasePrice: String(price ?? 0),
      barcode: productBarcode,
      name: productName,
    })
  }

  const receiptRows = [...docs.values()].map((doc) => ({
    source_id: doc.sourceId,
    receipt_date: doc.receiptDate,
    supplier: doc.supplier,
    supplier_source_id: doc.supplierSourceId,
    notes: doc.notes,
  }))
  const lineRows = [...docs.values()].flatMap((doc) =>
    doc.lines.map((line) => ({
      source_id: line.sourceId,
      receipt_source_id: doc.sourceId,
      item_source_id: line.itemSourceId,
      item_code: line.itemCode,
      barcode: line.barcode,
      name: line.name,
      quantity: line.quantity,
      purchase_price: line.purchasePrice,
    })),
  )

  await mkdir(outDir, { recursive: true })
  await writeFile(
    path.join(outDir, 'receipts.csv'),
    toCsv(['source_id', 'receipt_date', 'supplier', 'supplier_source_id', 'notes'], receiptRows),
    'utf8',
  )
  await writeFile(
    path.join(outDir, 'receipt-lines.csv'),
    toCsv(
      [
        'source_id',
        'receipt_source_id',
        'item_source_id',
        'item_code',
        'barcode',
        'name',
        'quantity',
        'purchase_price',
      ],
      lineRows,
    ),
    'utf8',
  )

  process.stdout.write(
    `Приходы: ${receiptRows.length}, строк: ${lineRows.length}, пропущено строк исходника: ${skipped}\n`,
  )
  process.stdout.write(`Записано в ${outDir}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
