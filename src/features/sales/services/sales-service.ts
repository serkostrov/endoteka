import { isSaleStatus, type SaleStatus } from '@/lib/constants/sales'
import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export type SaleListItem = {
  id: string
  invoiceNumber: string
  customerId: string | null
  customerName: string
  createdBy: string | null
  createdByName: string
  saleDate: string
  status: SaleStatus
  total: number
  createdAt: string
  confirmedAt: string | null
}

export type SaleFifoPreviewLine = {
  batchId: string
  receiptDate: string
  supplier: string
  quantity: number
  unitCost: number
}

export type SaleFifoPreview = {
  lines: SaleFifoPreviewLine[]
  enough: boolean
  shortfall: number
}

export type SaleAllocation = {
  id: string
  batchId: string
  movementId: string
  quantity: number
  unitCost: number
  receiptDate: string
  supplier: string
}

export type SaleLine = {
  id: string
  itemId: string
  itemName: string
  itemCode: string
  itemArticle: string
  itemBarcode: string
  unitName: string
  quantity: number
  unitPrice: number
  amount: number
  stockQuantity: number
  fifoPreview: SaleFifoPreview
  allocations: SaleAllocation[]
}

export type SaleDocument = {
  id: string
  invoiceNumber: string
  customerId: string | null
  customerName: string
  customerInn: string
  customerPhone: string
  createdBy: string | null
  createdByName: string
  saleDate: string
  status: SaleStatus
  total: number
  createdAt: string
  confirmedAt: string | null
  lines: SaleLine[]
}

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value
}

function asString(value: Json | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: Json | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: Json | number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function asBoolean(value: Json | undefined, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function mapStatus(value: string): SaleStatus {
  return isSaleStatus(value) ? value : 'draft'
}

function mapFifoPreview(value: Json | undefined): SaleFifoPreview {
  const row = asRecord(value)
  if (!row) {
    return { lines: [], enough: true, shortfall: 0 }
  }

  return {
    lines: Array.isArray(row.lines)
      ? row.lines.flatMap((line) => {
          const item = asRecord(line)
          if (!item) {
            return []
          }
          return [
            {
              batchId: asString(item.batch_id),
              receiptDate: asString(item.receipt_date),
              supplier: asString(item.supplier),
              quantity: asNumber(item.quantity),
              unitCost: asNumber(item.unit_cost),
            },
          ]
        })
      : [],
    enough: asBoolean(row.enough, true),
    shortfall: asNumber(row.shortfall),
  }
}

function mapAllocations(value: Json | undefined): SaleAllocation[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((line) => {
    const item = asRecord(line)
    if (!item || typeof item.id !== 'string') {
      return []
    }
    return [
      {
        id: item.id,
        batchId: asString(item.batch_id),
        movementId: asString(item.movement_id),
        quantity: asNumber(item.quantity),
        unitCost: asNumber(item.unit_cost),
        receiptDate: asString(item.receipt_date),
        supplier: asString(item.supplier),
      },
    ]
  })
}

function mapLine(value: Json): SaleLine | null {
  const row = asRecord(value)
  if (!row || typeof row.id !== 'string') {
    return null
  }

  return {
    id: row.id,
    itemId: asString(row.item_id),
    itemName: asString(row.item_name),
    itemCode: asString(row.item_code),
    itemArticle: asString(row.item_article),
    itemBarcode: asString(row.item_barcode),
    unitName: asString(row.unit_name),
    quantity: asNumber(row.quantity),
    unitPrice: asNumber(row.unit_price),
    amount: asNumber(row.amount),
    stockQuantity: asNumber(row.stock_quantity),
    fifoPreview: mapFifoPreview(row.fifo_preview),
    allocations: mapAllocations(row.allocations),
  }
}

export async function listSales(search: string, status: string, page: number, pageSize: number) {
  const { data, error } = await getSupabase().rpc('list_sales', {
    search_query: search,
    status_filter: status === 'all' ? '' : status,
    page_number: page,
    page_size: pageSize,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить продажи.')
  }

  const rows = data ?? []
  return {
    items: rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      saleDate: row.sale_date,
      status: mapStatus(row.status),
      total: asNumber(row.total),
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
    })),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

export async function getSale(id: string): Promise<SaleDocument> {
  const { data, error } = await getSupabase().rpc('get_sale', {
    target_sale_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить продажу.')
  }

  const row = asRecord(data)
  if (!row || typeof row.id !== 'string') {
    throw toAppError(new Error('Продажа не найдена.'), 'Продажа не найдена.')
  }

  return {
    id: row.id,
    invoiceNumber: asString(row.invoice_number),
    customerId: asNullableString(row.customer_id),
    customerName: asString(row.customer_name),
    customerInn: asString(row.customer_inn),
    customerPhone: asString(row.customer_phone),
    createdBy: asNullableString(row.created_by),
    createdByName: asString(row.created_by_name),
    saleDate: asString(row.sale_date),
    status: mapStatus(asString(row.status, 'draft')),
    total: asNumber(row.total),
    createdAt: asString(row.created_at),
    confirmedAt: asNullableString(row.confirmed_at),
    lines: Array.isArray(row.lines)
      ? row.lines.flatMap((line) => {
          const mapped = mapLine(line)
          return mapped ? [mapped] : []
        })
      : [],
  }
}

export async function createSale(input?: {
  customerId?: string | null
  saleDate?: string | null
  invoiceNumber?: string | null
  seedItemId?: string | null
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_sale', {
    p_customer_id: input?.customerId ?? null,
    p_sale_date: input?.saleDate ?? null,
    p_invoice_number: input?.invoiceNumber ?? null,
    p_seed_item_id: input?.seedItemId ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось создать продажу.')
  }

  return data
}

export async function updateSale(input: {
  saleId: string
  customerId: string | null
  saleDate: string
  invoiceNumber: string
}): Promise<void> {
  const { error } = await getSupabase().rpc('update_sale', {
    target_sale_id: input.saleId,
    p_customer_id: input.customerId,
    p_sale_date: input.saleDate,
    p_invoice_number: input.invoiceNumber,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить продажу.')
  }
}

export async function addSaleLine(input: {
  saleId: string
  itemId: string
  quantity: number
  unitPrice: number
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('add_sale_line', {
    target_sale_id: input.saleId,
    target_item_id: input.itemId,
    line_quantity: input.quantity,
    line_unit_price: input.unitPrice,
  })

  if (error) {
    throw toAppError(error, 'Не удалось добавить позицию.')
  }

  return data
}

export async function setSaleLine(input: {
  lineId: string
  quantity: number
  unitPrice: number
}): Promise<void> {
  const { error } = await getSupabase().rpc('set_sale_line', {
    target_line_id: input.lineId,
    line_quantity: input.quantity,
    line_unit_price: input.unitPrice,
  })

  if (error) {
    throw toAppError(error, 'Не удалось изменить строку.')
  }
}

export async function removeSaleLine(lineId: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_sale_line', {
    target_line_id: lineId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить строку.')
  }
}

export async function confirmSale(saleId: string): Promise<void> {
  const { error } = await getSupabase().rpc('confirm_sale', {
    target_sale_id: saleId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось подтвердить продажу.')
  }
}

export async function cancelSale(saleId: string): Promise<void> {
  const { error } = await getSupabase().rpc('cancel_sale', {
    target_sale_id: saleId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось отменить продажу.')
  }
}

export async function deleteSale(saleId: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_sale', {
    target_sale_id: saleId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить продажу.')
  }
}
