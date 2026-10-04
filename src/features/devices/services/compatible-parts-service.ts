import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'

const ITEM_PHOTOS_BUCKET = 'inventory-item-photos'
const TYPE_PHOTOS_BUCKET = 'reference-item-photos'

export type CompatiblePartGroup = {
  id: string
  name: string
  color: string
  sortOrder: number
  partCount: number
}

export type CompatiblePart = {
  id: string
  linkId: string
  code: string
  article: string
  name: string
  categoryName: string
  unitName: string
  stockQuantity: number
  coverUrl: string | null
  groupId: string
  groupName: string
  groupColor: string
  groupSortOrder: number
  sortOrder: number
}

export type CompatibleDeviceType = {
  id: string
  linkId: string
  code: string
  name: string
  setCode: string
  setName: string
  pathLabel: string
  coverUrl: string | null
  sortOrder: number
}

async function signPaths(bucket: string, paths: string[]) {
  const signedByPath = new Map<string, string>()
  if (paths.length === 0) {
    return signedByPath
  }
  const { data: signed } = await getSupabase().storage.from(bucket).createSignedUrls(paths, 3600)
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) {
      signedByPath.set(entry.path, entry.signedUrl)
    }
  }
  return signedByPath
}

/** Глобальные группы. Если передан referenceItemId — partCount только для этого вида. */
export async function listDeviceCompatiblePartGroups(
  referenceItemId?: string | null,
): Promise<CompatiblePartGroup[]> {
  const { data, error } = await getSupabase().rpc('list_device_compatible_part_groups', {
    target_reference_item_id: referenceItemId ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить группы деталей.')
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
    partCount: row.part_count,
  }))
}

export async function upsertDeviceCompatiblePartGroup(input: {
  id?: string
  name: string
  color: string
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('upsert_device_compatible_part_group', {
    target_id: input.id ?? null,
    target_name: input.name,
    target_color: input.color,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить группу.')
  }

  return data
}

export async function deleteDeviceCompatiblePartGroup(groupId: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_device_compatible_part_group', {
    target_id: groupId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить группу.')
  }
}

export async function reorderDeviceCompatiblePartGroups(groupIds: string[]): Promise<void> {
  const { error } = await getSupabase().rpc('reorder_device_compatible_part_groups', {
    group_ids: groupIds,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить порядок групп.')
  }
}

export async function reorderDeviceCompatibleParts(
  referenceItemId: string,
  groupId: string,
  linkIds: string[],
): Promise<void> {
  const { error } = await getSupabase().rpc('reorder_device_compatible_parts', {
    target_reference_item_id: referenceItemId,
    target_group_id: groupId,
    link_ids: linkIds,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить порядок деталей.')
  }
}

export async function listDeviceCompatibleParts(referenceItemId: string): Promise<CompatiblePart[]> {
  const { data, error } = await getSupabase().rpc('list_device_compatible_parts', {
    target_reference_item_id: referenceItemId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить подходящие детали.')
  }

  const rows = data ?? []
  const coverPaths = [
    ...new Set(rows.map((row) => row.cover_file_path).filter((path): path is string => Boolean(path))),
  ]
  const signedByPath = await signPaths(ITEM_PHOTOS_BUCKET, coverPaths)

  return rows.map((row) => ({
    id: row.id,
    linkId: row.link_id,
    code: row.code,
    article: row.article,
    name: row.name,
    categoryName: row.category_name,
    unitName: row.unit_name,
    stockQuantity: Number(row.stock_quantity ?? 0),
    coverUrl: row.cover_file_path ? (signedByPath.get(row.cover_file_path) ?? null) : null,
    groupId: row.group_id,
    groupName: row.group_name,
    groupColor: row.group_color,
    groupSortOrder: row.group_sort_order,
    sortOrder: row.sort_order,
  }))
}

export async function listInventoryItemCompatibleTypes(itemId: string): Promise<CompatibleDeviceType[]> {
  const { data, error } = await getSupabase().rpc('list_inventory_item_compatible_types', {
    target_item_id: itemId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить подходящие приборы.')
  }

  const rows = data ?? []
  const coverPaths = [
    ...new Set(rows.map((row) => row.cover_file_path).filter((path): path is string => Boolean(path))),
  ]
  const signedByPath = await signPaths(TYPE_PHOTOS_BUCKET, coverPaths)

  return rows.map((row) => ({
    id: row.id,
    linkId: row.link_id,
    code: row.code,
    name: row.name,
    setCode: row.set_code,
    setName: row.set_name,
    pathLabel: row.path_label,
    coverUrl: row.cover_file_path ? (signedByPath.get(row.cover_file_path) ?? null) : null,
    sortOrder: row.sort_order,
  }))
}

export async function addDeviceCompatiblePart(
  referenceItemId: string,
  itemId: string,
  groupId?: string | null,
): Promise<void> {
  const { error } = await getSupabase().rpc('add_device_compatible_part', {
    target_reference_item_id: referenceItemId,
    target_item_id: itemId,
    target_group_id: groupId ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось добавить связь.')
  }
}

export async function removeDeviceCompatiblePart(referenceItemId: string, itemId: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_device_compatible_part', {
    target_reference_item_id: referenceItemId,
    target_item_id: itemId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить связь.')
  }
}
