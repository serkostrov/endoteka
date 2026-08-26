import { toAppError } from '@/lib/errors'
import {
  isInventoryCountStatus,
  type InventoryCountLineFilter,
  type InventoryCountSeedMode,
  type InventoryCountStatus,
} from '@/lib/constants/inventory'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export type InventoryCountListItem = {
  id: string
  number: string
  status: InventoryCountStatus
  createdBy: string | null
  createdAt: string
  completedAt: string | null
  actorName: string
  lineCount: number
  countedCount: number
  discrepancyCount: number
}

export type InventoryCountDocument = {
  id: string
  number: string
  status: InventoryCountStatus
  createdBy: string | null
  createdAt: string
  completedAt: string | null
  actorName: string
  lineCount: number
  countedCount: number
  uncountedCount: number
  discrepancyCount: number
}

export type InventoryCountLine = {
  id: string
  itemId: string
  itemName: string
  itemCode: string
  itemArticle: string
  itemBarcode: string
  unitName: string
  expectedQuantity: number
  actualQuantity: number | null
  difference: number | null
  createdAt: string
}

export type InventoryCountStatementLine = {
  id: string
  itemId: string
  itemName: string
  itemCode: string
  itemArticle: string
  unitName: string
  expectedQuantity: number
  actualQuantity: number
  difference: number
}

export type InventoryCountStatement = {
  id: string
  number: string
  status: InventoryCountStatus
  createdAt: string
  completedAt: string | null
  actorName: string
  lines: InventoryCountStatementLine[]
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

function asNullableNumber(value: Json | number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }
  return asNumber(value)
}

function mapStatus(value: string): InventoryCountStatus {
  return isInventoryCountStatus(value) ? value : 'draft'
}

export async function listInventoryCounts(status: string, page: number, pageSize: number) {
  const { data, error } = await getSupabase().rpc('list_inventory_counts', {
    status_filter: status === 'all' ? '' : status,
    page_number: page,
    page_size: pageSize,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить инвентаризации.')
  }

  const rows = data ?? []
  return {
    items: rows.map((row) => ({
      id: row.id,
      number: row.number,
      status: mapStatus(row.status),
      createdBy: row.created_by,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      actorName: row.actor_name,
      lineCount: Number(row.line_count ?? 0),
      countedCount: Number(row.counted_count ?? 0),
      discrepancyCount: Number(row.discrepancy_count ?? 0),
    })),
    total: rows[0]?.total_count ?? 0,
  }
}

export async function getInventoryCount(id: string): Promise<InventoryCountDocument | null> {
  const { data, error } = await getSupabase().rpc('get_inventory_count', {
    target_count_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить документ инвентаризации.')
  }

  const row = asRecord(data)
  if (!row || typeof row.id !== 'string') {
    return null
  }

  return {
    id: row.id,
    number: asString(row.number),
    status: mapStatus(asString(row.status, 'draft')),
    createdBy: typeof row.created_by === 'string' ? row.created_by : null,
    createdAt: asString(row.created_at),
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
    actorName: asString(row.actor_name),
    lineCount: asNumber(row.line_count),
    countedCount: asNumber(row.counted_count),
    uncountedCount: asNumber(row.uncounted_count),
    discrepancyCount: asNumber(row.discrepancy_count),
  }
}

export async function listInventoryCountLines(
  countId: string,
  search: string,
  filter: InventoryCountLineFilter,
  page: number,
  pageSize: number,
) {
  const { data, error } = await getSupabase().rpc('list_inventory_count_lines', {
    target_count_id: countId,
    search_query: search,
    line_filter: filter,
    page_number: page,
    page_size: pageSize,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить строки инвентаризации.')
  }

  const rows = data ?? []
  return {
    items: rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      itemName: row.item_name,
      itemCode: row.item_code,
      itemArticle: row.item_article,
      itemBarcode: row.item_barcode,
      unitName: row.unit_name,
      expectedQuantity: asNumber(row.expected_quantity),
      actualQuantity: asNullableNumber(row.actual_quantity),
      difference: asNullableNumber(row.difference),
      createdAt: row.created_at,
    })),
    total: rows[0]?.total_count ?? 0,
  }
}

export async function getInventoryCountStatement(id: string): Promise<InventoryCountStatement | null> {
  const { data, error } = await getSupabase().rpc('get_inventory_count_statement', {
    target_count_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить акт расхождений.')
  }

  const row = asRecord(data)
  if (!row || typeof row.id !== 'string') {
    return null
  }

  return {
    id: row.id,
    number: asString(row.number),
    status: mapStatus(asString(row.status, 'draft')),
    createdAt: asString(row.created_at),
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
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
              unitName: asString(item.unit_name),
              expectedQuantity: asNumber(item.expected_quantity),
              actualQuantity: asNumber(item.actual_quantity),
              difference: asNumber(item.difference),
            },
          ]
        })
      : [],
  }
}

export async function createInventoryCount(input: {
  seedMode: InventoryCountSeedMode
  seedItemId?: string | null
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_inventory_count', {
    seed_mode: input.seedMode,
    seed_item_id: input.seedItemId ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось создать инвентаризацию.')
  }

  return data
}

export async function startInventoryCount(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('start_inventory_count', {
    target_count_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось начать инвентаризацию.')
  }
}

export async function cancelInventoryCount(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('cancel_inventory_count', {
    target_count_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось отменить инвентаризацию.')
  }
}

export async function completeInventoryCount(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('complete_inventory_count', {
    target_count_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось провести инвентаризацию.')
  }
}

export async function deleteInventoryCount(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_inventory_count', {
    target_count_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить инвентаризацию.')
  }
}

export async function addInventoryCountItem(countId: string, itemId: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('add_inventory_count_item', {
    target_count_id: countId,
    target_item_id: itemId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось добавить позицию.')
  }

  return data
}

export async function removeInventoryCountLine(lineId: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_inventory_count_line', {
    target_line_id: lineId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить строку.')
  }
}

export async function setInventoryCountLineActual(lineId: string, actual: number): Promise<void> {
  const { error } = await getSupabase().rpc('set_inventory_count_line_actual', {
    target_line_id: lineId,
    next_actual: actual,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить факт.')
  }
}

export async function incrementInventoryCountItem(countId: string, itemId: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('increment_inventory_count_item', {
    target_count_id: countId,
    target_item_id: itemId,
    increment_by: 1,
  })

  if (error) {
    throw toAppError(error, 'Не удалось учесть штрихкод.')
  }

  return data
}
