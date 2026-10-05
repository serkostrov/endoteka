/**
 * Выравнивание остатков CRM по журналу миграции RO App
 * (оприходования − продажи − запчасти заказов со списанием).
 *
 * Используется, когда снимок /warehouse/residue недоступен.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npm run import:roapp-stock-rebuild -- --dir import/data/roapp
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { createClient } from '@supabase/supabase-js'

import { parseCsv } from './csv.ts'

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
}

function num(value: string | undefined) {
  const n = Number(String(value ?? '').replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}

async function adjustItem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  itemId: string,
  purchasePrice: number,
  delta: number,
  reason: string,
) {
  if (delta === 0) {
    return
  }
  const adj = await supabase.from('inventory_adjustments').insert({ reason }).select('id').single()
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
      throw new Error(`Не хватило остатка для списания ${need}`)
    }
    return
  }

  const batch = await supabase
    .from('inventory_batches')
    .insert({
      item_id: itemId,
      receipt_id: null,
      supplier: 'Выравнивание по журналу RO App',
      receipt_date: new Date().toISOString().slice(0, 10),
      purchase_price: purchasePrice,
      quantity: delta,
      remaining_quantity: 0,
    })
    .select('id')
    .single()
  if (batch.error || !batch.data) {
    throw new Error(batch.error?.message ?? 'Не удалось создать партию')
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
  const dir = path.resolve(arg('--dir', 'import/data/roapp'))
  const dryRun = process.argv.includes('--dry-run')
  const outDir = path.resolve(arg('--out', 'import/reports/roapp-stock-rebuild'))
  await mkdir(outDir, { recursive: true })

  const warehouseText = await readFile(path.join(dir, 'warehouse-items.csv'), 'utf8')
  const barcodesText = await readFile(path.join(dir, 'barcodes.csv'), 'utf8')
  const receiptsText = await readFile(path.join(dir, 'receipt-lines.csv'), 'utf8')
  const salesText = await readFile(path.join(dir, 'sale-lines.csv'), 'utf8')
  const partsText = await readFile(path.join(dir, 'order-part-lines.csv'), 'utf8')

  const { rows: warehouseRows } = parseCsv(warehouseText)
  const { rows: barcodeRows } = parseCsv(barcodesText)
  const { rows: receiptRows } = parseCsv(receiptsText)
  const { rows: saleRows } = parseCsv(salesText)
  const { rows: partRows } = parseCsv(partsText)

  const codeToSource = new Map<string, string>()
  const nameToSource = new Map<string, string>()
  const barcodeToSource = new Map<string, string>()
  for (const row of warehouseRows) {
    const sourceId = String(row.source_id ?? '').trim()
    if (!sourceId) {
      continue
    }
    const code = String(row.code ?? '').trim()
    const name = String(row.name ?? '').trim()
    if (code) {
      codeToSource.set(code, sourceId)
    }
    if (name) {
      nameToSource.set(name, sourceId)
    }
  }
  for (const row of barcodeRows) {
    const barcode = String(row.barcode ?? '').trim()
    const sourceId = String(row.item_source_id ?? '').trim()
    if (barcode && sourceId) {
      barcodeToSource.set(barcode, sourceId)
    }
  }

  function resolveSource(row: Record<string, string>): string | null {
    const direct = String(row.item_source_id ?? '').trim()
    if (direct) {
      return direct
    }
    const barcode = String(row.barcode ?? '').trim()
    if (barcode && barcodeToSource.has(barcode)) {
      return barcodeToSource.get(barcode) ?? null
    }
    const code = String(row.item_code ?? '').trim()
    if (code && codeToSource.has(code)) {
      return codeToSource.get(code) ?? null
    }
    if (code && barcodeToSource.has(code)) {
      return barcodeToSource.get(code) ?? null
    }
    const name = String(row.name ?? '').trim()
    if (name && nameToSource.has(name)) {
      return nameToSource.get(name) ?? null
    }
    return null
  }

  const received = new Map<string, number>()
  const sold = new Map<string, number>()
  const consumed = new Map<string, number>()

  for (const row of receiptRows) {
    const sourceId = resolveSource(row)
    if (!sourceId) {
      continue
    }
    received.set(sourceId, (received.get(sourceId) ?? 0) + num(row.quantity))
  }
  for (const row of saleRows) {
    const sourceId = resolveSource(row)
    if (!sourceId) {
      continue
    }
    sold.set(sourceId, (sold.get(sourceId) ?? 0) + num(row.quantity))
  }
  for (const row of partRows) {
    if (String(row.consume_stock ?? '').trim() !== '1') {
      continue
    }
    const sourceId = resolveSource(row)
    if (!sourceId) {
      continue
    }
    consumed.set(sourceId, (consumed.get(sourceId) ?? 0) + num(row.quantity))
  }

  const targets = new Map<string, number>()
  for (const [sourceId, qty] of received) {
    const net = qty - (sold.get(sourceId) ?? 0) - (consumed.get(sourceId) ?? 0)
    targets.set(sourceId, Math.max(0, net))
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: itemKeys, error: itemKeysError } = await supabase
    .from('import_source_keys')
    .select('source_key, entity_id')
    .eq('dataset', 'warehouse_items')
  if (itemKeysError) {
    throw new Error(itemKeysError.message)
  }
  const itemBySource = new Map(
    (itemKeys ?? []).map((row) => [row.source_key, row.entity_id] as const),
  )

  type Item = { id: string; code: string; barcode: string; name: string; purchase_price: number }
  const items: Item[] = []
  const itemById = new Map<string, Item>()
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
      const item = {
        id: row.id,
        code: row.code ?? '',
        barcode: row.barcode ?? '',
        name: row.name ?? '',
        purchase_price: Number(row.purchase_price ?? 0),
      }
      items.push(item)
      itemById.set(item.id, item)
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

  const report: Array<Record<string, string>> = []
  let adjusted = 0
  let unchanged = 0
  let failed = 0
  let missing = 0
  const touched = new Set<string>()

  for (const [sourceId, targetQty] of targets) {
    const itemId = itemBySource.get(`ext:warehouse_items:${sourceId}`)
    if (!itemId) {
      missing += 1
      report.push({
        status: 'missing_item',
        source_id: sourceId,
        target: String(targetQty),
        current: '',
        delta: '',
      })
      continue
    }
    touched.add(itemId)
    const item = itemById.get(itemId)
    const current = stockByItem.get(itemId) ?? 0
    const delta = targetQty - current
    report.push({
      status: delta === 0 ? 'ok' : 'adjust',
      source_id: sourceId,
      code: item?.code ?? '',
      name: item?.name ?? '',
      barcode: item?.barcode ?? '',
      received: String(received.get(sourceId) ?? 0),
      sold: String(sold.get(sourceId) ?? 0),
      consumed: String(consumed.get(sourceId) ?? 0),
      target: String(targetQty),
      current: String(current),
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
        itemId,
        item?.purchase_price ?? 0,
        delta,
        `Выравнивание по журналу RO App (цель ${targetQty})`,
      )
      stockByItem.set(itemId, targetQty)
      adjusted += 1
    } catch (error) {
      failed += 1
      process.stderr.write(
        `${sourceId}: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  }

  let zeroed = 0
  for (const [itemId, current] of stockByItem) {
    if (touched.has(itemId) || current <= 0) {
      continue
    }
    const item = itemById.get(itemId)
    report.push({
      status: 'zero_extra',
      source_id: '',
      code: item?.code ?? '',
      name: item?.name ?? '',
      barcode: item?.barcode ?? '',
      target: '0',
      current: String(current),
      delta: String(-current),
    })
    if (dryRun) {
      zeroed += 1
      continue
    }
    try {
      await adjustItem(
        supabase,
        itemId,
        item?.purchase_price ?? 0,
        -current,
        'Выравнивание по журналу RO App (лишний остаток → 0)',
      )
      stockByItem.set(itemId, 0)
      zeroed += 1
    } catch (error) {
      failed += 1
      process.stderr.write(`${itemId}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  const headers = [
    'status',
    'source_id',
    'code',
    'name',
    'barcode',
    'received',
    'sold',
    'consumed',
    'target',
    'current',
    'delta',
  ]
  const lines = [
    headers.join(','),
    ...report.map((row) =>
      headers
        .map((key) => {
          const value = row[key] ?? ''
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
        })
        .join(','),
    ),
  ]
  await writeFile(path.join(outDir, 'stock-rebuild.csv'), `${lines.join('\n')}\n`, 'utf8')

  process.stdout.write(
    [
      dryRun ? 'DRY-RUN' : 'DONE',
      `targets=${targets.size}`,
      `unchanged=${unchanged}`,
      `adjusted=${adjusted}`,
      `zeroed_extra=${zeroed}`,
      `missing_item=${missing}`,
      `failed=${failed}`,
      `report=${path.join(outDir, 'stock-rebuild.csv')}`,
      '',
    ].join('\n'),
  )
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
