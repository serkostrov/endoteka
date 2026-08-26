import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { ReferenceItemRow, ReferenceSetSummaryRow } from '@/types/database'

export type ReferenceSetSummary = {
  id: string
  code: string
  name: string
  description: string | null
  parentSetId: string | null
  parentSetCode: string | null
  parentSetName: string | null
  isSystem: boolean
  sortOrder: number
  itemCount: number
  activeItemCount: number
}

export type ReferenceItem = {
  id: string
  setId: string
  parentId: string | null
  parentName: string | null
  parentCode: string | null
  code: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
  isSystem: boolean
}

export type ReferenceItemInput = {
  id?: string
  setId: string
  code: string
  name: string
  description: string
  parentId: string | null
}

function mapSet(row: ReferenceSetSummaryRow): ReferenceSetSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    parentSetId: row.parent_set_id,
    parentSetCode: row.parent_set_code,
    parentSetName: row.parent_set_name,
    isSystem: row.is_system,
    sortOrder: row.sort_order,
    itemCount: row.item_count,
    activeItemCount: row.active_item_count,
  }
}

function mapItem(
  row: ReferenceItemRow,
  parents: Map<string, Pick<ReferenceItemRow, 'name' | 'code'>>,
): ReferenceItem {
  const parent = row.parent_id ? parents.get(row.parent_id) : undefined
  return {
    id: row.id,
    setId: row.set_id,
    parentId: row.parent_id,
    parentName: parent?.name ?? null,
    parentCode: parent?.code ?? null,
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isSystem: row.is_system,
  }
}

export async function listReferenceSets(): Promise<ReferenceSetSummary[]> {
  const { data, error } = await getSupabase()
    .from('reference_set_summaries')
    .select('*')
    .order('sort_order')
    .order('name')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить справочники.')
  }

  return (data ?? []).map(mapSet)
}

export async function listReferenceItemsBySetCode(setCode: string): Promise<ReferenceItem[]> {
  const sets = await listReferenceSets()
  const set = sets.find((item) => item.code === setCode)
  if (!set) {
    return []
  }

  return listReferenceItems(set.id)
}

export async function listReferenceItems(setId: string): Promise<ReferenceItem[]> {
  const { data, error } = await getSupabase()
    .from('reference_items')
    .select('*')
    .eq('set_id', setId)
    .order('sort_order')
    .order('name')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить записи справочника.')
  }

  const rows = data ?? []
  const parentIds = [...new Set(rows.map((row) => row.parent_id).filter((id): id is string => Boolean(id)))]
  const parents = new Map<string, Pick<ReferenceItemRow, 'name' | 'code'>>()

  if (parentIds.length > 0) {
    const { data: parentRows, error: parentError } = await getSupabase()
      .from('reference_items')
      .select('id, name, code')
      .in('id', parentIds)

    if (parentError) {
      throw toAppError(parentError, 'Не удалось загрузить родительские записи.')
    }

    for (const parent of parentRows ?? []) {
      parents.set(parent.id, parent)
    }
  }

  return rows.map((row) => mapItem(row, parents))
}

export async function getReferenceItemUsage(itemId: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('reference_item_usage_count', {
    target_item_id: itemId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось проверить использование записи.')
  }

  return data ?? 0
}

export async function upsertReferenceItem(input: ReferenceItemInput): Promise<void> {
  const { error } = await getSupabase().rpc('upsert_reference_item', {
    target_id: input.id ?? null,
    target_set_id: input.setId,
    item_code: input.code,
    item_name: input.name,
    item_description: input.description,
    parent_item_id: input.parentId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить запись справочника.')
  }
}

export async function setReferenceItemActive(itemId: string, isActive: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('set_reference_item_active', {
    target_id: itemId,
    next_active: isActive,
  })

  if (error) {
    throw toAppError(error, 'Не удалось изменить статус записи.')
  }
}

export async function reorderReferenceItems(setId: string, itemIds: string[]): Promise<void> {
  const { error } = await getSupabase().rpc('reorder_reference_items', {
    target_set_id: setId,
    item_ids: itemIds,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить порядок записей.')
  }
}

export async function deleteReferenceItem(itemId: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_reference_item', {
    target_id: itemId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить запись справочника.')
  }
}
