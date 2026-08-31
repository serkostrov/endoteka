import { AppError, toAppError } from '@/lib/errors'
import {
  isInventoryMovementType,
  type InventoryMovementType,
} from '@/lib/constants/inventory'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export class InventoryDuplicateError extends AppError {
  readonly existingItemId: string | null

  constructor(existingItemId: string | null, cause?: unknown) {
    super('INVENTORY_DUPLICATE', 'Такое наименование уже в справочнике', cause)
    this.existingItemId = existingItemId
  }
}

export function isInventoryDuplicateError(error: unknown): error is InventoryDuplicateError {
  return error instanceof InventoryDuplicateError
}

export type InventoryItem = {
  id: string
  code: string
  article: string
  barcode: string
  name: string
  categoryId: string
  categoryName: string
  unitId: string
  unitName: string
  purchasePrice: number
  repairPrice: number
  retailPrice: number
  stockQuantity: number
  createdAt: string
  updatedAt: string
}

export type InventoryItemInput = {
  name: string
  code: string
  article: string
  barcode: string
  categoryId: string
  unitId: string
  purchasePrice: number
  repairPrice: number
  retailPrice: number
}

export type InventoryListResult = {
  items: InventoryItem[]
  total: number
}

export type InventoryNameMatch = {
  id: string
  name: string
  code: string
}

export type InventoryBatch = {
  id: string
  receiptId: string | null
  supplier: string
  receiptDate: string
  purchasePrice: number
  quantity: number
  remainingQuantity: number
  createdAt: string
}

export type InventoryMovement = {
  id: string
  quantity: number
  unitPrice: number
  movementType: InventoryMovementType
  referenceType: string
  referenceId: string
  createdAt: string
  batchId: string
  batchReceiptDate: string
  batchSupplier: string
  actorName: string
  destination: string
}

export type InventoryItemCard = {
  item: InventoryItem
  batches: InventoryBatch[]
  movements: InventoryMovement[]
}

export type InventoryReceiptListItem = {
  id: string
  supplier: string
  receiptDate: string
  notes: string
  createdAt: string
  actorName: string
  lineCount: number
  totalQuantity: number
}

export type InventoryReceiptLine = {
  id: string
  itemId: string
  itemName: string
  itemCode: string
  itemArticle: string
  quantity: number
  unitPrice: number
  batchId: string
  remainingQuantity: number
}

export type InventoryReceiptDetail = {
  id: string
  supplier: string
  receiptDate: string
  notes: string
  createdAt: string
  actorName: string
  lines: InventoryReceiptLine[]
}

export type ReceiptLineInput = {
  itemId: string
  quantity: number
  purchasePrice: number
}

export type InventoryAdjustmentListItem = {
  id: string
  reason: string
  createdAt: string
  actorName: string
  itemName: string
  quantity: number
}

export type OrderPartBatch = {
  receiptDate: string
  supplier: string
  quantity: number
}

export type OrderInventoryUsage = {
  id: string
  itemId: string
  itemName: string
  itemCode: string
  itemArticle: string
  itemBarcode: string
  unitName: string
  quantity: number
  unitPrice: number
  batches: OrderPartBatch[]
  actorName: string
  createdAt: string
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

function asId(value: Json | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readHint(error: unknown) {
  if (typeof error === 'object' && error !== null && 'hint' in error && typeof error.hint === 'string') {
    return error.hint
  }
  return ''
}

function throwIfDuplicate(error: unknown, fallback: string): never {
  const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : ''
  if (message.includes('Такое наименование уже в справочнике')) {
    throw new InventoryDuplicateError(readHint(error) || null, error)
  }
  throw toAppError(error, fallback)
}

function mapItem(row: {
  id: string
  code: string
  article: string
  barcode: string
  name: string
  category_id: string
  category_name: string
  unit_id: string
  unit_name: string
  purchase_price: number | string
  repair_price: number | string
  retail_price: number | string
  stock_quantity: number | string
  created_at: string
  updated_at: string
}): InventoryItem {
  return {
    id: row.id,
    code: row.code,
    article: row.article,
    barcode: row.barcode,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    unitId: row.unit_id,
    unitName: row.unit_name,
    purchasePrice: asNumber(row.purchase_price),
    repairPrice: asNumber(row.repair_price),
    retailPrice: asNumber(row.retail_price),
    stockQuantity: asNumber(row.stock_quantity),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapItemFromCard(value: Json | undefined): InventoryItem | null {
  const row = asRecord(value)
  if (!row || typeof row.id !== 'string') {
    return null
  }

  return {
    id: row.id,
    code: asString(row.code),
    article: asString(row.article),
    barcode: asString(row.barcode),
    name: asString(row.name),
    categoryId: asString(row.category_id),
    categoryName: asString(row.category_name),
    unitId: asString(row.unit_id),
    unitName: asString(row.unit_name),
    purchasePrice: asNumber(row.purchase_price),
    repairPrice: asNumber(row.repair_price),
    retailPrice: asNumber(row.retail_price),
    stockQuantity: asNumber(row.stock_quantity),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function mapBatch(value: Json): InventoryBatch | null {
  const row = asRecord(value)
  if (!row || typeof row.id !== 'string') {
    return null
  }

  return {
    id: row.id,
    receiptId: asId(row.receipt_id),
    supplier: asString(row.supplier),
    receiptDate: asString(row.receipt_date),
    purchasePrice: asNumber(row.purchase_price),
    quantity: asNumber(row.quantity),
    remainingQuantity: asNumber(row.remaining_quantity),
    createdAt: asString(row.created_at),
  }
}

function mapMovement(value: Json): InventoryMovement | null {
  const row = asRecord(value)
  if (!row || typeof row.id !== 'string') {
    return null
  }

  const movementType = asString(row.movement_type)
  if (!isInventoryMovementType(movementType)) {
    return null
  }

  return {
    id: row.id,
    quantity: asNumber(row.quantity),
    unitPrice: asNumber(row.unit_price),
    movementType,
    referenceType: asString(row.reference_type),
    referenceId: asString(row.reference_id),
    createdAt: asString(row.created_at),
    batchId: asString(row.batch_id),
    batchReceiptDate: asString(row.batch_receipt_date),
    batchSupplier: asString(row.batch_supplier),
    actorName: asString(row.actor_name),
    destination: asString(row.destination),
  }
}

export async function searchInventoryItems(
  search: string,
  page: number,
  pageSize: number,
  stockFilter = 'all',
): Promise<InventoryListResult> {
  const { data, error } = await getSupabase().rpc('search_inventory_items', {
    search_query: search,
    page_number: page,
    page_size: pageSize,
    stock_filter: stockFilter,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить склад.')
  }

  const rows = data ?? []
  return {
    items: rows.map(mapItem),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

export async function findInventoryItemByName(name: string, excludeId?: string): Promise<InventoryNameMatch[]> {
  const { data, error } = await getSupabase().rpc('find_inventory_item_by_name', {
    name_query: name,
    exclude_id: excludeId ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось проверить наименование.')
  }

  return (data ?? []).map((row) => ({ id: row.id, name: row.name, code: row.code }))
}

export async function findInventoryItemsByBarcode(barcode: string): Promise<InventoryItem[]> {
  const { data, error } = await getSupabase().rpc('find_inventory_items_by_barcode', {
    barcode_query: barcode,
  })

  if (error) {
    throw toAppError(error, 'Не удалось найти позицию по штрихкоду.')
  }

  return (data ?? []).map(mapItem)
}

export async function getInventoryItemCard(id: string): Promise<InventoryItemCard | null> {
  const { data, error } = await getSupabase().rpc('get_inventory_item_card', {
    target_item_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить карточку позиции.')
  }

  const payload = asRecord(data)
  const item = mapItemFromCard(payload?.item)
  if (!item) {
    return null
  }

  return {
    item,
    batches: Array.isArray(payload?.batches) ? payload.batches.flatMap((row) => {
      const batch = mapBatch(row)
      return batch ? [batch] : []
    }) : [],
    movements: Array.isArray(payload?.movements) ? payload.movements.flatMap((row) => {
      const movement = mapMovement(row)
      return movement ? [movement] : []
    }) : [],
  }
}

export async function createInventoryItem(input: InventoryItemInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_inventory_item', {
    item_name: input.name,
    item_code: input.code,
    item_article: input.article,
    item_barcode: input.barcode,
    item_category_id: input.categoryId,
    item_unit_id: input.unitId,
    item_purchase_price: input.purchasePrice,
    item_repair_price: input.repairPrice,
    item_retail_price: input.retailPrice,
  })

  if (error) {
    throwIfDuplicate(error, 'Не удалось создать позицию.')
  }

  return data
}

export async function updateInventoryItem(itemId: string, input: InventoryItemInput): Promise<void> {
  const { error } = await getSupabase().rpc('update_inventory_item', {
    target_item_id: itemId,
    item_name: input.name,
    item_code: input.code,
    item_article: input.article,
    item_barcode: input.barcode,
    item_category_id: input.categoryId,
    item_unit_id: input.unitId,
    item_purchase_price: input.purchasePrice,
    item_repair_price: input.repairPrice,
    item_retail_price: input.retailPrice,
  })

  if (error) {
    throwIfDuplicate(error, 'Не удалось сохранить позицию.')
  }
}

export async function deleteInventoryItem(itemId: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_inventory_item', {
    target_item_id: itemId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить позицию.')
  }
}

export async function receiveInventory(input: {
  supplier: string
  supplierId?: string | null
  receiptDate: string
  notes: string
  lines: ReceiptLineInput[]
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('receive_inventory', {
    supplier_name: input.supplier,
    doc_receipt_date: input.receiptDate,
    doc_notes: input.notes,
    lines: input.lines.map((line) => ({
      item_id: line.itemId,
      quantity: line.quantity,
      purchase_price: line.purchasePrice,
    })),
    supplier_customer_id: input.supplierId ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось оформить приход.')
  }

  return data
}

export async function consumeInventoryForOrder(
  orderId: string,
  itemId: string,
  quantity: number,
  unitPrice?: number,
): Promise<void> {
  const { error } = await getSupabase().rpc('consume_inventory_for_order', {
    target_order_id: orderId,
    target_item_id: itemId,
    consume_quantity: quantity,
    line_unit_price: unitPrice ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось списать позицию в заказ.')
  }
}

export async function setOrderPartLine(
  lineId: string,
  quantity: number,
  unitPrice: number,
): Promise<void> {
  const { error } = await getSupabase().rpc('set_order_part_line', {
    target_line_id: lineId,
    line_quantity: quantity,
    line_unit_price: unitPrice,
  })

  if (error) {
    throw toAppError(error, 'Не удалось изменить запчасть в заказе.')
  }
}

export async function removeOrderPartLine(lineId: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_order_part_line', {
    target_line_id: lineId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить запчасть из заказа.')
  }
}

export async function adjustInventory(input: {
  itemId: string
  quantityDelta: number
  reason: string
}): Promise<string> {
  const { error, data } = await getSupabase().rpc('adjust_inventory', {
    target_item_id: input.itemId,
    quantity_delta: input.quantityDelta,
    reason_text: input.reason,
  })

  if (error) {
    throw toAppError(error, 'Не удалось выполнить корректировку.')
  }

  return data
}

export async function listInventoryReceipts(page: number, pageSize: number) {
  const { data, error } = await getSupabase().rpc('list_inventory_receipts', {
    page_number: page,
    page_size: pageSize,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить приходы.')
  }

  const rows = data ?? []
  return {
    items: rows.map((row) => ({
      id: row.id,
      supplier: row.supplier,
      receiptDate: row.receipt_date,
      notes: row.notes,
      createdAt: row.created_at,
      actorName: row.actor_name,
      lineCount: Number(row.line_count ?? 0),
      totalQuantity: asNumber(row.total_quantity),
    })),
    total: rows[0]?.total_count ?? 0,
  }
}

export async function getInventoryReceipt(id: string): Promise<InventoryReceiptDetail | null> {
  const { data, error } = await getSupabase().rpc('get_inventory_receipt', {
    target_receipt_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить приход.')
  }

  const row = asRecord(data)
  if (!row || typeof row.id !== 'string') {
    return null
  }

  return {
    id: row.id,
    supplier: asString(row.supplier),
    receiptDate: asString(row.receipt_date),
    notes: asString(row.notes),
    createdAt: asString(row.created_at),
    actorName: asString(row.actor_name),
    lines: Array.isArray(row.lines)
      ? row.lines.flatMap((line) => {
          const item = asRecord(line)
          if (!item || typeof item.id !== 'string') {
            return []
          }
          return [
            {
              id: item.id,
              itemId: asString(item.item_id),
              itemName: asString(item.item_name),
              itemCode: asString(item.item_code),
              itemArticle: asString(item.item_article),
              quantity: asNumber(item.quantity),
              unitPrice: asNumber(item.unit_price),
              batchId: asString(item.batch_id),
              remainingQuantity: asNumber(item.remaining_quantity),
            },
          ]
        })
      : [],
  }
}

export type InventoryReceiptDeleteMode = 'hide' | 'reverse'

export async function deleteInventoryReceipt(
  receiptId: string,
  mode: InventoryReceiptDeleteMode,
): Promise<void> {
  const { error } = await getSupabase().rpc('delete_inventory_receipt', {
    target_receipt_id: receiptId,
    delete_mode: mode,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить приход.')
  }
}

export async function listInventoryAdjustments(page: number, pageSize: number) {
  const { data, error } = await getSupabase().rpc('list_inventory_adjustments', {
    page_number: page,
    page_size: pageSize,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить инвентаризацию.')
  }

  const rows = data ?? []
  return {
    items: rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      createdAt: row.created_at,
      actorName: row.actor_name,
      itemName: row.item_name,
      quantity: asNumber(row.quantity),
    })),
    total: rows[0]?.total_count ?? 0,
  }
}

export async function getOrderInventoryUsage(orderId: string): Promise<OrderInventoryUsage[]> {
  const { data, error } = await getSupabase().rpc('get_order_inventory_usage', {
    target_order_id: orderId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить списания по заказу.')
  }

  if (!Array.isArray(data)) {
    return []
  }

  return data.flatMap((row) => {
    const item = asRecord(row)
    if (!item || typeof item.id !== 'string') {
      return []
    }

    return [
      {
        id: item.id,
        itemId: asString(item.item_id),
        itemName: asString(item.item_name),
        itemCode: asString(item.item_code),
        itemArticle: asString(item.item_article),
        itemBarcode: asString(item.item_barcode),
        unitName: asString(item.unit_name),
        quantity: asNumber(item.quantity),
        unitPrice: asNumber(item.unit_price),
        batches: Array.isArray(item.batches)
          ? item.batches.flatMap((batch) => {
              const row = asRecord(batch)
              if (!row) {
                return []
              }
              return [
                {
                  receiptDate: asString(row.receipt_date),
                  supplier: asString(row.supplier),
                  quantity: asNumber(row.quantity),
                },
              ]
            })
          : [],
        actorName: asString(item.actor_name),
        createdAt: asString(item.created_at),
      },
    ]
  })
}
