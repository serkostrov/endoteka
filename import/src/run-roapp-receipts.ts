/**
 * Полный цикл миграции оприходований RO App → приходы Endoteka.
 *
 *   ROAPP_API_KEY=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npm run import:roapp-receipts -- --dir import/data/roapp
 *
 * Порядок:
 * 1) пробует Public API /warehouse/income-transactions
 * 2) иначе ищет Excel/CSV выгрузку в --dir
 * 3) пишет receipts.csv + receipt-lines.csv
 * 4) пакетно создаёт документы прихода в Supabase
 */
import { spawn } from 'node:child_process'
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const BASE = 'https://api.roapp.io/v2'
const PAGE_DELAY_MS = 350

const SOURCE_NAME_RE =
  /(оприход|приход|income|incomes|receipt|receipts|posting|postings|arrival|arrivals)/i

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

async function exists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function apiGet<T>(apiKey: string, pathName: string): Promise<T> {
  const response = await fetch(`${BASE}${pathName}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`RO App ${pathName}: HTTP ${response.status} ${body.slice(0, 200)}`)
  }
  return (await response.json()) as T
}

async function fetchAllPages<T>(apiKey: string, pathName: string, label: string): Promise<T[]> {
  const first = await apiGet<{ paging?: { total_pages?: number; count?: number }; data?: T[] }>(
    apiKey,
    `${pathName}${pathName.includes('?') ? '&' : '?'}page=1`,
  )
  const totalPages = Math.max(1, first.paging?.total_pages ?? 1)
  const rows = [...(first.data ?? [])]
  process.stdout.write(`${label}: 1/${totalPages} (всего ${first.paging?.count ?? rows.length})\n`)
  for (let page = 2; page <= totalPages; page += 1) {
    await sleep(PAGE_DELAY_MS)
    const next = await apiGet<{ data?: T[] }>(
      apiKey,
      `${pathName}${pathName.includes('?') ? '&' : '?'}page=${page}`,
    )
    rows.push(...(next.data ?? []))
    process.stdout.write(`${label}: ${page}/${totalPages}\n`)
  }
  return rows
}

type RoClient = {
  id?: number
  is_organization?: boolean
  name?: string
  first_name?: string
  last_name?: string
}

type RoIncomeLine = {
  id?: number
  quantity?: string | number
  cost?: string | number
  price?: string | number
  code?: string
  sku?: string
  title?: string
  entity?: { id?: number; code?: string; sku?: string; title?: string }
  product?: { id?: number; code?: string; sku?: string; title?: string }
}

type RoIncome = {
  id?: number
  created_at?: string
  comment?: string
  notes?: string
  supplier?: RoClient | null
  client?: RoClient | null
  products?: RoIncomeLine[]
  items?: RoIncomeLine[]
}

async function tryExportFromApi(apiKey: string, outDir: string): Promise<boolean> {
  const locations = await apiGet<Array<{ id?: number }>>(apiKey, '/company/locations')
  const branchId = locations.find((row) => typeof row.id === 'number')?.id
  if (!branchId) {
    process.stdout.write('API: локации не найдены — пропуск выгрузки оприходований.\n')
    return false
  }
  try {
    const incomes = await fetchAllPages<RoIncome>(
      apiKey,
      `/warehouse/income-transactions/?branch_id=${branchId}`,
      'Оприходования',
    )
    const receiptRows: Record<string, string>[] = []
    const lineRows: Record<string, string>[] = []
    for (const income of incomes) {
      if (!income?.id) {
        continue
      }
      const receiptSourceId = `ro-rcp-${income.id}`
      const supplier = income.supplier ?? income.client ?? null
      const supplierName =
        String(supplier?.name || `${supplier?.first_name || ''} ${supplier?.last_name || ''}`.trim()).trim() ||
        'Поставщик RO App'
      receiptRows.push({
        source_id: receiptSourceId,
        receipt_date: income.created_at ? String(income.created_at).slice(0, 10) : '',
        supplier: supplierName,
        supplier_source_id: supplier?.id ? `ro-cus-${supplier.id}` : '',
        notes: String(income.comment || income.notes || '').trim(),
      })
      const lines = income.products ?? income.items ?? []
      lines.forEach((line, index) => {
        const product = line.product ?? line.entity
        const productId = product?.id ?? line.id
        if (!productId) {
          return
        }
        lineRows.push({
          source_id: `ro-rcp-line-${income.id}-${line.id ?? index + 1}`,
          receipt_source_id: receiptSourceId,
          item_source_id: `ro-item-${productId}`,
          item_code:
            String(product?.code || line.code || '').trim() ||
            String(product?.sku || line.sku || '').trim() ||
            `RO-${productId}`,
          quantity: String(line.quantity ?? '0').replace(',', '.'),
          purchase_price: String(line.cost ?? line.price ?? '0').replace(',', '.'),
        })
      })
    }
    if (receiptRows.length === 0) {
      process.stdout.write('API: оприходований нет.\n')
      return false
    }
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
          'quantity',
          'purchase_price',
        ],
        lineRows,
      ),
      'utf8',
    )
    process.stdout.write(`API → CSV: приходов ${receiptRows.length}, строк ${lineRows.length}\n`)
    return true
  } catch (error) {
    process.stdout.write(
      `API оприходований недоступен: ${error instanceof Error ? error.message.slice(0, 180) : String(error)}\n`,
    )
    return false
  }
}

async function excelToCsv(excelPath: string, csvPath: string): Promise<void> {
  const script = `
import sys, csv, subprocess
from pathlib import Path
src = Path(sys.argv[1])
dst = Path(sys.argv[2])
suffix = src.suffix.lower()
if suffix == '.xls':
  try:
    import xlrd
  except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--user', 'xlrd==1.2.0', '-q'])
    import xlrd
  book = xlrd.open_workbook(str(src))
  sheet = book.sheet_by_index(0)
  with dst.open('w', encoding='utf-8', newline='') as f:
    w = csv.writer(f)
    for r in range(sheet.nrows):
      row = []
      for c in range(sheet.ncols):
        cell = sheet.cell(r, c)
        val = cell.value
        if cell.ctype == xlrd.XL_CELL_DATE:
          try:
            val = xlrd.xldate_as_datetime(val, book.datemode).strftime('%Y-%m-%d')
          except Exception:
            pass
        row.append(val)
      w.writerow(row)
else:
  try:
    import openpyxl
  except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--user', 'openpyxl', '-q'])
    import openpyxl
  wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
  ws = wb.active
  with dst.open('w', encoding='utf-8', newline='') as f:
    w = csv.writer(f)
    for row in ws.iter_rows(values_only=True):
      w.writerow(['' if c is None else c for c in row])
print(dst)
`
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', ['-c', script, excelPath, csvPath], { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Не удалось прочитать Excel (${excelPath}), код ${code}`))
      }
    })
  })
}

async function findSourceFile(dir: string): Promise<string | null> {
  const explicit = arg('--in').trim()
  if (explicit) {
    return path.resolve(explicit)
  }
  const preferred = [
    'оприходования.xls',
    'оприходования.xlsx',
    'оприходования.csv',
    'roapp-incomes.xlsx',
    'roapp-incomes.xls',
    'roapp-incomes.csv',
    'incomes.xlsx',
    'incomes.xls',
    'incomes.csv',
  ]
  for (const name of preferred) {
    const full = path.join(dir, name)
    if (await exists(full)) {
      return full
    }
  }
  const entries = await readdir(dir)
  const match = entries
    .filter((name) => SOURCE_NAME_RE.test(name) && /\.(csv|xlsx|xls)$/i.test(name))
    .sort()
  return match[0] ? path.join(dir, match[0]) : null
}

async function ensureCsvFromSource(dir: string): Promise<boolean> {
  if ((await exists(path.join(dir, 'receipts.csv'))) && (await exists(path.join(dir, 'receipt-lines.csv')))) {
    const text = await readFile(path.join(dir, 'receipts.csv'), 'utf8')
    if (text.split('\n').filter((line) => line.trim()).length > 1) {
      process.stdout.write('Найдены готовые receipts.csv / receipt-lines.csv\n')
      return true
    }
  }

  const source = await findSourceFile(dir)
  if (!source) {
    return false
  }

  let csvSource = source
  if (/\.xlsx?$/i.test(source)) {
    csvSource = path.join(dir, 'roapp-incomes.converted.csv')
    process.stdout.write(`Excel → CSV: ${path.basename(source)}\n`)
    await excelToCsv(source, csvSource)
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve('node_modules/tsx/dist/cli.mjs'),
        path.resolve('import/src/convert-roapp-receipts.ts'),
        '--in',
        csvSource,
        '--out',
        dir,
      ],
      { stdio: 'inherit', env: process.env },
    )
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Конвертация приходов завершилась с кодом ${code}`))
      }
    })
  })
  return true
}

async function syncReceipts(dir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve('node_modules/tsx/dist/cli.mjs'),
        path.resolve('import/src/sync-roapp-receipts.ts'),
        '--dir',
        dir,
      ],
      { stdio: 'inherit', env: process.env },
    )
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Синхронизация приходов завершилась с кодом ${code}`))
      }
    })
  })
}

async function main() {
  const dir = path.resolve(arg('--dir', 'import/data/roapp'))
  await mkdir(dir, { recursive: true })
  const apiKey = process.env.ROAPP_API_KEY?.trim() || arg('--api-key').trim()

  let ready = false
  if (apiKey) {
    ready = await tryExportFromApi(apiKey, dir)
  } else {
    process.stdout.write('ROAPP_API_KEY не задан — пробуем локальную выгрузку Excel/CSV.\n')
  }

  if (!ready) {
    ready = await ensureCsvFromSource(dir)
  }

  if (!ready) {
    const dropHint = [
      'Нет данных оприходований.',
      '',
      'API склада на аккаунте отвечает 404. Положите выгрузку RO App в папку:',
      `  ${dir}/оприходования.xlsx`,
      'или',
      `  ${dir}/roapp-incomes.csv`,
      '',
      'RO App → Склад → Оприходования → экспорт Excel.',
      'Затем снова: npm run import:roapp-receipts -- --dir import/data/roapp',
      '',
    ].join('\n')
    throw new Error(dropHint)
  }

  await syncReceipts(dir)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
