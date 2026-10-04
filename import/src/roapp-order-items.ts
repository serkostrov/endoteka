/**
 * Догружает состав заказов из RO App в CSV рядом с уже выгруженными orders.csv.
 *
 *   ROAPP_API_KEY=… npx tsx import/src/roapp-order-items.ts --dir import/data/roapp
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { parseCsv } from './csv.ts'

const BASE = 'https://api.roapp.io/v2'
const PAGE_DELAY_MS = 250

type RoOrderItem = {
  id?: number
  quantity?: string | number
  price?: string | number
  cost?: string | number
  write_offs?: unknown[] | null
  entity?: {
    id?: number
    type?: string
    code?: string
    sku?: string
    title?: string
  }
}

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

function isServiceType(type: string | undefined) {
  const value = (type ?? '').toLowerCase()
  return value === 'labor' || value === 'service' || value === 'work'
}

async function main() {
  const apiKey = process.env.ROAPP_API_KEY?.trim() || arg('--api-key').trim()
  const dir = path.resolve(arg('--dir', 'import/data/roapp'))
  if (!apiKey) {
    throw new Error('Укажите ROAPP_API_KEY или --api-key.')
  }

  const ordersPath = path.join(dir, 'orders.csv')
  const text = await readFile(ordersPath, 'utf8')
  const { rows: orders } = parseCsv(text)
  if (orders.length === 0) {
    throw new Error(`Нет заказов в ${ordersPath}`)
  }

  const serviceRows: Record<string, string>[] = []
  const partRows: Record<string, string>[] = []
  let withItems = 0
  let empty = 0

  for (const [index, order] of orders.entries()) {
    const sourceId = String(order.source_id ?? '').trim()
    const number = String(order.number ?? '').trim()
    const roId = sourceId.replace(/^ro-ord-/, '')
    if (!roId) {
      continue
    }
    await sleep(PAGE_DELAY_MS)
    const items = await apiGet<RoOrderItem[]>(apiKey, `/orders/${roId}/items`)
    if (!Array.isArray(items) || items.length === 0) {
      empty += 1
    } else {
      withItems += 1
      items.forEach((item, itemIndex) => {
        const entity = item.entity
        if (!entity?.id) {
          return
        }
        const quantity = String(item.quantity ?? '0').replace(',', '.')
        const unitPrice = String(item.price ?? '0').replace(',', '.')
        const name = String(entity.title || '').trim() || `Позиция ${entity.id}`
        const lineSourceId = `ro-ord-item-${item.id ?? `${roId}-${itemIndex + 1}`}`
        if (isServiceType(entity.type)) {
          serviceRows.push({
            source_id: lineSourceId,
            order_source_id: sourceId,
            order_number: number,
            name,
            description: '',
            quantity,
            unit_price: unitPrice,
          })
          return
        }
        if ((entity.type ?? '').toLowerCase() === 'product') {
          const itemSourceId = `ro-item-${entity.id}`
          const itemCode =
            String(entity.code || '').trim() ||
            String(entity.sku || '').trim() ||
            `RO-${entity.id}`
          const hasWriteOff = Array.isArray(item.write_offs) && item.write_offs.length > 0
          partRows.push({
            source_id: lineSourceId,
            order_source_id: sourceId,
            order_number: number,
            item_source_id: itemSourceId,
            item_code: itemCode,
            name,
            quantity,
            unit_price: unitPrice,
            consume_stock: hasWriteOff ? '1' : '0',
          })
        }
      })
    }
    if ((index + 1) % 25 === 0 || index + 1 === orders.length) {
      process.stdout.write(
        `Состав заказов: ${index + 1}/${orders.length} (с позициями ${withItems}, пустых ${empty})\n`,
      )
    }
  }

  await writeFile(
    path.join(dir, 'order-service-lines.csv'),
    toCsv(
      ['source_id', 'order_source_id', 'order_number', 'name', 'description', 'quantity', 'unit_price'],
      serviceRows,
    ),
    'utf8',
  )
  await writeFile(
    path.join(dir, 'order-part-lines.csv'),
    toCsv(
      [
        'source_id',
        'order_source_id',
        'order_number',
        'item_source_id',
        'item_code',
        'name',
        'quantity',
        'unit_price',
        'consume_stock',
      ],
      partRows,
    ),
    'utf8',
  )

  process.stdout.write(
    `\nГотово: услуг ${serviceRows.length}, запчастей ${partRows.length} → ${dir}\n`,
  )
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
})
