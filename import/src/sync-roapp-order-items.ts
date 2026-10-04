/**
 * Быстрый пакетный импорт состава заказов из CSV.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npm run import:roapp-order-items-sync -- --dir import/data/roapp
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { createClient } from '@supabase/supabase-js'

import { parseCsv } from './csv.ts'

const CHUNK = 200

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

  const serviceText = await readFile(path.join(dir, 'order-service-lines.csv'), 'utf8')
  const partText = await readFile(path.join(dir, 'order-part-lines.csv'), 'utf8')
  const { rows: serviceRows } = parseCsv(serviceText)
  const { rows: partRows } = parseCsv(partText)

  const { data: orderKeys, error: orderKeysError } = await supabase
    .from('import_source_keys')
    .select('source_key, entity_id')
    .eq('dataset', 'orders')
  if (orderKeysError) {
    throw new Error(orderKeysError.message)
  }
  const orderBySource = new Map(
    (orderKeys ?? []).map((row) => [row.source_key, row.entity_id] as const),
  )

  // Fallback: order number → id
  const neededNumbers = new Set<string>()
  for (const row of [...serviceRows, ...partRows]) {
    const sourceId = String(row.order_source_id ?? '').trim()
    const key = sourceId ? `ext:orders:${sourceId}` : ''
    if (key && orderBySource.has(key)) {
      continue
    }
    const number = String(row.order_number ?? '').trim()
    if (number) {
      neededNumbers.add(number)
    }
  }
  const orderByNumber = new Map<string, string>()
  const numberList = [...neededNumbers]
  for (let offset = 0; offset < numberList.length; offset += CHUNK) {
    const chunk = numberList.slice(offset, offset + CHUNK)
    const { data, error } = await supabase.from('orders').select('id, number').in('number', chunk)
    if (error) {
      throw new Error(error.message)
    }
    for (const row of data ?? []) {
      orderByNumber.set(row.number, row.id)
    }
  }

  function resolveOrderId(row: Record<string, string>) {
    const sourceId = String(row.order_source_id ?? '').trim()
    if (sourceId) {
      const mapped = orderBySource.get(`ext:orders:${sourceId}`)
      if (mapped) {
        return mapped
      }
    }
    const number = String(row.order_number ?? '').trim()
    return number ? (orderByNumber.get(number) ?? null) : null
  }

  const { data: existingServiceKeys } = await supabase
    .from('import_source_keys')
    .select('source_key')
    .eq('dataset', 'order_service_lines')
  const existingServices = new Set((existingServiceKeys ?? []).map((row) => row.source_key))

  const { data: existingPartKeys } = await supabase
    .from('import_source_keys')
    .select('source_key')
    .eq('dataset', 'order_part_lines')
  const existingParts = new Set((existingPartKeys ?? []).map((row) => row.source_key))

  // Resolve inventory items by source key / code
  const { data: itemKeys } = await supabase
    .from('import_source_keys')
    .select('source_key, entity_id')
    .eq('dataset', 'warehouse_items')
  const itemBySource = new Map((itemKeys ?? []).map((row) => [row.source_key, row.entity_id] as const))

  let servicesCreated = 0
  let servicesSkipped = 0
  let servicesFailed = 0
  const serviceKeyRows: Array<{
    dataset: string
    source_key: string
    entity_type: string
    entity_id: string
    payload_hash: string
  }> = []

  for (const row of serviceRows) {
    const sourceId = String(row.source_id ?? '').trim()
    const sourceKey = sourceId ? `ext:order_service_lines:${sourceId}` : ''
    if (sourceKey && existingServices.has(sourceKey)) {
      servicesSkipped += 1
      continue
    }
    const orderId = resolveOrderId(row)
    const name = String(row.name ?? '').trim()
    const quantity = num(row.quantity, 0)
    const unitPrice = num(row.unit_price, 0)
    if (!orderId || !name || quantity <= 0) {
      servicesFailed += 1
      continue
    }
    const { data, error } = await supabase
      .from('order_service_lines')
      .insert({
        order_id: orderId,
        template_id: null,
        name,
        description: String(row.description ?? '').trim(),
        quantity,
        unit_price: unitPrice,
      })
      .select('id')
      .single()
    if (error || !data) {
      servicesFailed += 1
      continue
    }
    servicesCreated += 1
    if (sourceKey) {
      serviceKeyRows.push({
        dataset: 'order_service_lines',
        source_key: sourceKey,
        entity_type: 'order_service_line',
        entity_id: data.id,
        payload_hash: `svc:${orderId}:${name}:${quantity}:${unitPrice}`,
      })
      existingServices.add(sourceKey)
    }
  }

  for (let offset = 0; offset < serviceKeyRows.length; offset += CHUNK) {
    const chunk = serviceKeyRows.slice(offset, offset + CHUNK)
    const { error } = await supabase.from('import_source_keys').upsert(chunk)
    if (error) {
      throw new Error(error.message)
    }
  }

  // Item codes for parts
  const codes = [
    ...new Set(partRows.map((row) => String(row.item_code ?? '').trim()).filter(Boolean)),
  ]
  const itemByCode = new Map<string, string>()
  for (let offset = 0; offset < codes.length; offset += CHUNK) {
    const chunk = codes.slice(offset, offset + CHUNK)
    const { data, error } = await supabase.from('inventory_items').select('id, code').in('code', chunk)
    if (error) {
      throw new Error(error.message)
    }
    for (const row of data ?? []) {
      itemByCode.set(row.code, row.id)
    }
  }

  let partsCreated = 0
  let partsSkipped = 0
  let partsFailed = 0
  const partKeyRows: Array<{
    dataset: string
    source_key: string
    entity_type: string
    entity_id: string
    payload_hash: string
  }> = []

  for (const row of partRows) {
    const sourceId = String(row.source_id ?? '').trim()
    const sourceKey = sourceId ? `ext:order_part_lines:${sourceId}` : ''
    if (sourceKey && existingParts.has(sourceKey)) {
      partsSkipped += 1
      continue
    }
    const orderId = resolveOrderId(row)
    const quantity = num(row.quantity, 0)
    const unitPrice = num(row.unit_price, 0)
    const name = String(row.name ?? '').trim()
    const itemSourceId = String(row.item_source_id ?? '').trim()
    const itemCode = String(row.item_code ?? '').trim()
    const itemId =
      (itemSourceId ? itemBySource.get(`ext:warehouse_items:${itemSourceId}`) : null) ??
      (itemCode ? itemByCode.get(itemCode) : null) ??
      null
    if (!orderId || quantity <= 0 || (!itemId && !name)) {
      partsFailed += 1
      continue
    }
    const { data, error } = await supabase
      .from('order_part_lines')
      .insert({
        order_id: orderId,
        item_id: itemId,
        name: itemId ? '' : name,
        quantity,
        unit_price: unitPrice,
      })
      .select('id')
      .single()
    if (error || !data) {
      partsFailed += 1
      continue
    }
    partsCreated += 1
    if (sourceKey) {
      partKeyRows.push({
        dataset: 'order_part_lines',
        source_key: sourceKey,
        entity_type: 'order_part_line',
        entity_id: data.id,
        payload_hash: `part:${orderId}:${itemId ?? name}:${quantity}:${unitPrice}`,
      })
      existingParts.add(sourceKey)
    }
  }

  for (let offset = 0; offset < partKeyRows.length; offset += CHUNK) {
    const chunk = partKeyRows.slice(offset, offset + CHUNK)
    const { error } = await supabase.from('import_source_keys').upsert(chunk)
    if (error) {
      throw new Error(error.message)
    }
  }

  process.stdout.write(
    [
      `Услуги: created=${servicesCreated} skipped=${servicesSkipped} failed=${servicesFailed}`,
      `Запчасти: created=${partsCreated} skipped=${partsSkipped} failed=${partsFailed}`,
      '',
    ].join('\n'),
  )
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
})
