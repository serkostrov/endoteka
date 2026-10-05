/**
 * Выравнивание остатков CRM по снимку остатков RO App (Excel/CSV).
 *
 * Источник истины — текущий остаток RO App:
 *   https://web.roapp.io/warehouse/residue → экспорт Excel
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npm run import:roapp-stock-sync -- --in import/data/roapp/остатки.xls
 *
 * Алгоритм:
 * 1) читает остатки RO App (штрихкод / код / наименование + количество)
 * 2) для каждой позиции CRM считает delta = target − current
 * 3) пишет inventory_adjustment (+/−) так, чтобы остаток совпал
 * 4) позиции CRM с остатком > 0, которых нет в снимке RO App, обнуляет
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { createClient } from '@supabase/supabase-js'

import { parseCsv } from './csv.ts'
import { parseNumber } from './normalize.ts'

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
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
  barcode: ['barcode', 'штрихкод', 'штрих-код', 'ean'],
  code: ['code', 'код', 'внутренний код', 'item_code'],
  article: ['article', 'артикул', 'sku'],
  name: ['name', 'title', 'наименование', 'название', 'товар'],
  quantity: [
    'quantity',
    'qty',
    'количество',
    'кол-во',
    'остаток',
    'кол-во остаток',
    'кол-во, шт',
    'quantity_residue',
    'residue',
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
  // fuzzy: header contains keyword
  for (const [key, value] of byNorm) {
    if (!value?.trim()) {
      continue
    }
    if (field === 'quantity' && (key.includes('кол') || key.includes('остат') || key.includes('qty'))) {
      return value.trim()
    }
    if (field === 'barcode' && key.includes('штрих')) {
      return value.trim()
    }
    if (field === 'name' && (key.includes('наимен') || key.includes('назван'))) {
      return value.trim()
    }
  }
  return ''
}

async function excelToCsv(excelPath: string, csvPath: string): Promise<void> {
  const script = `
import sys, csv, subprocess
from pathlib import Path
src = Path(sys.argv[1]); dst = Path(sys.argv[2])
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
`
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', ['-c', script, excelPath, csvPath], { stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Excel read failed: ${code}`))))
  })
}

async function adjustItem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  itemId: string,
  purchasePrice: number,
  delta: number,
  reason: string,
): Promise<void> {
  if (delta === 0) {
    return
  }
  const adj = await supabase
    .from('inventory_adjustments')
    .insert({ reason })
    .select('id')
    .single()
  if (adj.error || !adj.data) {
    throw new Error(adj.error?.message ?? 'Не удалось создать корректировку')
  }
  const adjustmentId = adj.data.id

  if (delta < 0) {
    let need = Math.abs(delta)
    const { data: batches, error } = await supabase
      .from('inventory_batches')
      .select('id, remaining_quantity, purchase_price')
      .eq('item_id', itemId)
      .gt('remaining_quantity', 0)
      .order('receipt_date')
      .order('created_at')
      .order('id')
    if (error) {
      throw new Error(error.message)
    }
    for (const batch of batches ?? []) {
      if (need <= 0) {
        break
      }
      const available = Number(batch.remaining_quantity)
      const take = Math.min(available, need)
      // remaining обновляет триггер apply_inventory_movement
      const mov = await supabase.from('inventory_movements').insert({
        item_id: itemId,
        batch_id: batch.id,
        quantity: -take,
        unit_price: Number(batch.purchase_price ?? purchasePrice),
        movement_type: 'inventory_adjustment',
        reference_type: 'inventory_adjustment',
        reference_id: adjustmentId,
      })
      if (mov.error) {
        throw new Error(mov.error.message)
      }
      need -= take
    }
    if (need > 0.0001) {
      throw new Error(`Не хватило остатка для списания ${need} по ${itemId}`)
    }
    return
  }

  const batch = await supabase
    .from('inventory_batches')
    .insert({
      item_id: itemId,
      receipt_id: null,
      supplier: 'Выравнивание RO App',
      receipt_date: new Date().toISOString().slice(0, 10),
      purchase_price: purchasePrice,
      quantity: delta,
      remaining_quantity: 0,
    })
    .select('id')
    .single()
  if (batch.error || !batch.data) {
    throw new Error(batch.error?.message ?? 'Не удалось создать партию корректировки')
  }
  const mov = await supabase.from('inventory_movements').insert({
    item_id: itemId,
    batch_id: batch.data.id,
    quantity: delta,
    unit_price: purchasePrice,
    movement_type: 'inventory_adjustment',
    reference_type: 'inventory_adjustment',
    reference_id: adjustmentId,
  })
  if (mov.error) {
    throw new Error(mov.error.message)
  }
}

async function main() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.')
  }
  const inPath = path.resolve(arg('--in') || 'import/data/roapp/остатки.xls')
  const dryRun = process.argv.includes('--dry-run')
  const outDir = path.resolve(arg('--out', 'import/reports/roapp-stock-sync'))
  await mkdir(outDir, { recursive: true })

  let csvPath = inPath
  if (/\.xlsx?$/i.test(inPath)) {
    csvPath = path.join(path.dirname(inPath), 'roapp-stock.converted.csv')
    process.stdout.write(`Excel → CSV: ${path.basename(inPath)}\n`)
    await excelToCsv(inPath, csvPath)
  }

  const text = await readFile(csvPath, 'utf8')
  const { headers, rows } = parseCsv(text)
  if (headers.length === 0) {
    throw new Error(`Пустой файл остатков: ${inPath}`)
  }
  process.stdout.write(`Колонки: ${headers.join(' | ')}\n`)

  type Target = { qty: number; barcode: string; code: string; name: string }
  const targets: Target[] = []
  for (const row of rows) {
    const qty = parseNumber(pickField(row, 'quantity'))
    if (qty === null || qty < 0) {
      continue
    }
    targets.push({
      qty,
      barcode: pickField(row, 'barcode'),
      code: pickField(row, 'code') || pickField(row, 'article'),
      name: pickField(row, 'name'),
    })
  }
  process.stdout.write(`Строк в снимке RO App: ${targets.length}\n`)

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  type Item = {
    id: string
    code: string
    barcode: string
    name: string
    purchase_price: number
    stock: number
  }
  const items: Item[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, code, barcode, name, purchase_price')
      .range(from, from + 999)
    if (error) {
      throw new Error(error.message)
    }
    const chunk = data ?? []
    for (const row of chunk) {
      items.push({
        id: row.id,
        code: row.code ?? '',
        barcode: row.barcode ?? '',
        name: row.name ?? '',
        purchase_price: Number(row.purchase_price ?? 0),
        stock: 0,
      })
    }
    if (chunk.length < 1000) {
      break
    }
  }

  const stockByItem = new Map<string, number>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('inventory_batches')
      .select('item_id, remaining_quantity')
      .gt('remaining_quantity', 0)
      .range(from, from + 999)
    if (error) {
      throw new Error(error.message)
    }
    const chunk = data ?? []
    for (const row of chunk) {
      stockByItem.set(
        row.item_id,
        (stockByItem.get(row.item_id) ?? 0) + Number(row.remaining_quantity),
      )
    }
    if (chunk.length < 1000) {
      break
    }
  }
  for (const item of items) {
    item.stock = stockByItem.get(item.id) ?? 0
  }

  const byBarcode = new Map(items.filter((i) => i.barcode).map((i) => [i.barcode, i] as const))
  const byCode = new Map(items.filter((i) => i.code).map((i) => [i.code, i] as const))
  const byName = new Map(items.filter((i) => i.name).map((i) => [i.name, i] as const))

  const matched = new Set<string>()
  const report: Array<Record<string, string>> = []
  let adjusted = 0
  let unchanged = 0
  let missing = 0
  let failed = 0

  for (const target of targets) {
    const item =
      (target.barcode ? byBarcode.get(target.barcode) : undefined) ??
      (target.code ? byCode.get(target.code) : undefined) ??
      (target.name ? byName.get(target.name) : undefined)
    if (!item) {
      missing += 1
      report.push({
        status: 'missing_in_crm',
        barcode: target.barcode,
        code: target.code,
        name: target.name,
        ro_qty: String(target.qty),
        crm_qty: '',
        delta: '',
      })
      continue
    }
    matched.add(item.id)
    const delta = target.qty - item.stock
    report.push({
      status: delta === 0 ? 'ok' : 'adjust',
      barcode: item.barcode,
      code: item.code,
      name: item.name,
      ro_qty: String(target.qty),
      crm_qty: String(item.stock),
      delta: String(delta),
    })
    if (delta === 0) {
      unchanged += 1
      continue
    }
    if (dryRun) {
      adjusted += 1
      continue
    }
    try {
      await adjustItem(
        supabase,
        item.id,
        item.purchase_price,
        delta,
        `Выравнивание остатка по RO App (${target.qty})`,
      )
      item.stock = target.qty
      adjusted += 1
    } catch (error) {
      failed += 1
      process.stderr.write(
        `${item.code || item.barcode}: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  }

  // CRM items with stock but absent from RO snapshot → zero
  let zeroed = 0
  for (const item of items) {
    if (matched.has(item.id) || item.stock <= 0) {
      continue
    }
    report.push({
      status: 'zero_absent_in_ro',
      barcode: item.barcode,
      code: item.code,
      name: item.name,
      ro_qty: '0',
      crm_qty: String(item.stock),
      delta: String(-item.stock),
    })
    if (dryRun) {
      zeroed += 1
      continue
    }
    try {
      await adjustItem(
        supabase,
        item.id,
        item.purchase_price,
        -item.stock,
        'Выравнивание остатка по RO App (нет в снимке → 0)',
      )
      item.stock = 0
      zeroed += 1
    } catch (error) {
      failed += 1
      process.stderr.write(
        `${item.code || item.barcode}: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  }

  const reportCsv = [
    'status,barcode,code,name,ro_qty,crm_qty,delta',
    ...report.map((row) =>
      ['status', 'barcode', 'code', 'name', 'ro_qty', 'crm_qty', 'delta']
        .map((key) => {
          const value = row[key] ?? ''
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
        })
        .join(','),
    ),
  ].join('\n')
  await writeFile(path.join(outDir, 'stock-diff.csv'), `${reportCsv}\n`, 'utf8')

  process.stdout.write(
    [
      dryRun ? 'DRY-RUN' : 'DONE',
      `matched_ok=${unchanged}`,
      `adjusted=${adjusted}`,
      `zeroed_absent=${zeroed}`,
      `missing_in_crm=${missing}`,
      `failed=${failed}`,
      `report=${path.join(outDir, 'stock-diff.csv')}`,
      '',
    ].join('\n'),
  )
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
