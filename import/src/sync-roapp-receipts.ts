/**
 * Пакетный импорт приходов RO App из receipts.csv + receipt-lines.csv.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npm run import:roapp-receipts-sync -- --dir import/data/roapp
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { createClient } from '@supabase/supabase-js'

import { parseCsv } from './csv.ts'

const CHUNK = 150

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
}

function num(value: string | undefined, fallback = 0) {
  const n = Number(String(value ?? '').replace(',', '.').trim())
  return Number.isFinite(n) ? n : fallback
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
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const receiptsText = await readFile(path.join(dir, 'receipts.csv'), 'utf8')
  const linesText = await readFile(path.join(dir, 'receipt-lines.csv'), 'utf8')
  const { rows: receiptRows } = parseCsv(receiptsText)
  const { rows: lineRows } = parseCsv(linesText)
  if (receiptRows.length === 0) {
    throw new Error(`В ${dir}/receipts.csv нет документов прихода.`)
  }

  const linesByReceipt = new Map<string, Array<Record<string, string>>>()
  for (const line of lineRows) {
    const parent = String(line.receipt_source_id ?? '').trim()
    if (!parent) {
      continue
    }
    const list = linesByReceipt.get(parent) ?? []
    list.push(line)
    linesByReceipt.set(parent, list)
  }

  const { data: existingKeys, error: existingError } = await supabase
    .from('import_source_keys')
    .select('source_key, entity_id')
    .eq('dataset', 'receipts')
  if (existingError) {
    throw new Error(existingError.message)
  }
  const existing = new Map((existingKeys ?? []).map((row) => [row.source_key, row.entity_id] as const))

  const { data: itemKeys, error: itemKeysError } = await supabase
    .from('import_source_keys')
    .select('source_key, entity_id')
    .eq('dataset', 'warehouse_items')
  if (itemKeysError) {
    throw new Error(itemKeysError.message)
  }
  const itemBySource = new Map((itemKeys ?? []).map((row) => [row.source_key, row.entity_id] as const))

  const { data: customerKeys } = await supabase
    .from('import_source_keys')
    .select('source_key, entity_id')
    .eq('dataset', 'customers')
  const customerBySource = new Map(
    (customerKeys ?? []).map((row) => [row.source_key, row.entity_id] as const),
  )

  const itemByCode = new Map<string, string>()
  const itemByBarcode = new Map<string, string>()
  const itemByName = new Map<string, string>()
  const itemPurchaseById = new Map<string, number>()

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, code, barcode, name, purchase_price')
      .range(from, from + 999)
    if (error) {
      throw new Error(error.message)
    }
    const rows = data ?? []
    for (const row of rows) {
      itemPurchaseById.set(row.id, Number(row.purchase_price ?? 0))
      if (row.code) {
        itemByCode.set(row.code, row.id)
      }
      if (row.barcode) {
        itemByBarcode.set(row.barcode, row.id)
      }
      if (row.name) {
        itemByName.set(row.name, row.id)
      }
    }
    if (rows.length < 1000) {
      break
    }
  }
  process.stdout.write(
    `Номенклатура: ${itemPurchaseById.size} (штрихкодов: ${itemByBarcode.size})\n`,
  )

  const { data: sampleItem, error: sampleError } = await supabase
    .from('inventory_items')
    .select('category_id, unit_id')
    .limit(1)
    .maybeSingle()
  if (sampleError) {
    throw new Error(sampleError.message)
  }
  const defaultCategoryId = sampleItem?.category_id ?? null
  const defaultUnitId = sampleItem?.unit_id ?? null

  function resolveItemId(row: Record<string, string>): string | null {
    const sourceId = String(row.item_source_id ?? '').trim()
    if (sourceId) {
      const mapped = itemBySource.get(`ext:warehouse_items:${sourceId}`)
      if (mapped) {
        return mapped
      }
    }
    const barcode = String(row.barcode ?? '').trim()
    if (barcode && itemByBarcode.has(barcode)) {
      return itemByBarcode.get(barcode) ?? null
    }
    const code = String(row.item_code ?? '').trim()
    if (code && itemByCode.has(code)) {
      return itemByCode.get(code) ?? null
    }
    if (code && itemByBarcode.has(code)) {
      return itemByBarcode.get(code) ?? null
    }
    const name = String(row.name ?? '').trim()
    if (name && itemByName.has(name)) {
      return itemByName.get(name) ?? null
    }
    const nameLower = name.toLowerCase()
    if (nameLower) {
      for (const [existingName, id] of itemByName) {
        if (existingName.toLowerCase() === nameLower) {
          return id
        }
      }
    }
    return null
  }

  async function ensureItemId(row: Record<string, string>): Promise<string | null> {
    const existing = resolveItemId(row)
    if (existing) {
      return existing
    }
    const name = String(row.name ?? row.item_code ?? '').trim()
    if (!name || !defaultCategoryId || !defaultUnitId) {
      return null
    }
    const barcode = String(row.barcode ?? '').trim()
    const codeBase = barcode || name.slice(0, 40)
    const code = `RO-RCP-${codeBase}`.replace(/\s+/g, '_').slice(0, 64)
    const purchasePrice = num(row.purchase_price, 0)
    const inserted = await supabase
      .from('inventory_items')
      .insert({
        code,
        name,
        article: '',
        barcode,
        category_id: defaultCategoryId,
        unit_id: defaultUnitId,
        purchase_price: purchasePrice,
        repair_price: 0,
        retail_price: purchasePrice,
      })
      .select('id, purchase_price')
      .single()
    if (inserted.error || !inserted.data) {
      // race: code already exists
      if (barcode) {
        const byBarcode = await supabase
          .from('inventory_items')
          .select('id, purchase_price')
          .eq('barcode', barcode)
          .maybeSingle()
        if (byBarcode.data) {
          itemByBarcode.set(barcode, byBarcode.data.id)
          itemPurchaseById.set(byBarcode.data.id, Number(byBarcode.data.purchase_price ?? 0))
          return byBarcode.data.id
        }
      }
      const byName = await supabase
        .from('inventory_items')
        .select('id, purchase_price')
        .eq('name', name)
        .maybeSingle()
      if (byName.data) {
        itemByName.set(name, byName.data.id)
        itemPurchaseById.set(byName.data.id, Number(byName.data.purchase_price ?? 0))
        return byName.data.id
      }
      process.stderr.write(`Не удалось создать позицию «${name}»: ${inserted.error?.message ?? ''}\n`)
      return null
    }
    itemByName.set(name, inserted.data.id)
    if (barcode) {
      itemByBarcode.set(barcode, inserted.data.id)
    }
    itemByCode.set(code, inserted.data.id)
    itemPurchaseById.set(inserted.data.id, Number(inserted.data.purchase_price ?? 0))
    return inserted.data.id
  }

  let created = 0
  let skipped = 0
  let failed = 0
  const keyRows: Array<{
    dataset: string
    source_key: string
    entity_type: string
    entity_id: string
    payload_hash: string
  }> = []

  for (const [index, receipt] of receiptRows.entries()) {
    const sourceId = String(receipt.source_id ?? '').trim()
    const sourceKey = sourceId ? `ext:receipts:${sourceId}` : ''
    if (sourceKey && existing.has(sourceKey)) {
      skipped += 1
      continue
    }

    const receiptDate = String(receipt.receipt_date ?? '').trim().slice(0, 10)
    const supplier = String(receipt.supplier ?? '').trim() || 'Поставщик RO App'
    const notes = String(receipt.notes ?? '').trim() || 'Импорт прихода RO App'
    const supplierSourceId = String(receipt.supplier_source_id ?? '').trim()
    const supplierId = supplierSourceId
      ? (customerBySource.get(`ext:customers:${supplierSourceId}`) ?? null)
      : null
    const rawLines = sourceId ? (linesByReceipt.get(sourceId) ?? []) : []
    if (!receiptDate || rawLines.length === 0) {
      failed += 1
      process.stderr.write(`Приход #${index + 1} (${sourceId || 'без id'}): нет даты или строк.\n`)
      continue
    }

    const lines: Array<{ itemId: string; quantity: number; purchasePrice: number }> = []
    let lineFailed = false
    for (const [lineIndex, line] of rawLines.entries()) {
      const quantity = num(line.quantity, 0)
      const itemId = await ensureItemId(line)
      if (!itemId || quantity <= 0) {
        lineFailed = true
        process.stderr.write(
          `Приход ${sourceId}: строка ${lineIndex + 1} — номенклатура не найдена (${line.item_source_id || line.item_code || line.name || '—'}).\n`,
        )
        break
      }
      const purchasePrice = num(line.purchase_price, itemPurchaseById.get(itemId) ?? 0)
      if (purchasePrice < 0) {
        lineFailed = true
        break
      }
      lines.push({ itemId, quantity, purchasePrice })
    }
    if (lineFailed || lines.length === 0) {
      failed += 1
      continue
    }

    const inserted = await supabase
      .from('inventory_receipts')
      .insert({
        supplier,
        supplier_id: supplierId,
        receipt_date: receiptDate,
        notes,
      })
      .select('id')
      .single()
    if (inserted.error || !inserted.data) {
      failed += 1
      process.stderr.write(
        `Приход ${sourceId}: ${inserted.error?.message ?? 'не удалось создать документ'}\n`,
      )
      continue
    }
    const receiptId = inserted.data.id

    let batchFailed = false
    for (const line of lines) {
      const batch = await supabase
        .from('inventory_batches')
        .insert({
          item_id: line.itemId,
          receipt_id: receiptId,
          supplier,
          receipt_date: receiptDate,
          purchase_price: line.purchasePrice,
          quantity: line.quantity,
          remaining_quantity: 0,
        })
        .select('id')
        .single()
      if (batch.error || !batch.data) {
        batchFailed = true
        process.stderr.write(`Приход ${sourceId}: ${batch.error?.message ?? 'партия'}\n`)
        break
      }
      const movement = await supabase.from('inventory_movements').insert({
        item_id: line.itemId,
        batch_id: batch.data.id,
        quantity: line.quantity,
        unit_price: line.purchasePrice,
        movement_type: 'receipt',
        reference_type: 'receipt',
        reference_id: receiptId,
      })
      if (movement.error) {
        batchFailed = true
        process.stderr.write(`Приход ${sourceId}: ${movement.error.message}\n`)
        break
      }
    }
    if (batchFailed) {
      failed += 1
      continue
    }

    created += 1
    if (sourceKey) {
      keyRows.push({
        dataset: 'receipts',
        source_key: sourceKey,
        entity_type: 'inventory_receipt',
        entity_id: receiptId,
        payload_hash: `rcp:${receiptDate}:${supplier}:${lines.length}`,
      })
      existing.set(sourceKey, receiptId)
    }

    if ((created + skipped + failed) % 25 === 0) {
      process.stdout.write(
        `Приходы: created=${created} skipped=${skipped} failed=${failed} / ${receiptRows.length}\n`,
      )
    }
  }

  for (let offset = 0; offset < keyRows.length; offset += CHUNK) {
    const chunk = keyRows.slice(offset, offset + CHUNK)
    const { error } = await supabase.from('import_source_keys').upsert(chunk)
    if (error) {
      throw new Error(error.message)
    }
  }

  process.stdout.write(
    `Приходы: created=${created} skipped=${skipped} failed=${failed} (строк исходника: ${lineRows.length})\n`,
  )
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
