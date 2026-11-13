import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Json, OrderAssemblyAttachmentRow } from '@/types/database'

import { calcCompletenessPct } from '../lib/completeness'

export const ASSEMBLY_ATTACHMENTS_BUCKET = 'order-assembly-attachments'
export const ASSEMBLY_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/jpg,application/pdf'
export const ASSEMBLY_FILE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'application/pdf',
] as const
export const ASSEMBLY_FILE_MAX_BYTES = 5_368_709_120

export type AssemblyTab = 'active' | 'done'

export type AssemblyListItem = {
  id: string
  number: string
  customerId: string
  customerName: string
  deviceId: string
  serialNumber: string
  deviceLabel: string
  deviceBrand: string
  deviceModel: string
  statusId: string
  statusCode: string
  statusName: string
  createdAt: string
  updatedAt: string
  completenessPct: number
}

export type AssemblyPart = {
  id: string
  name: string
  qtyRequired: number
  qtyCollected: number
  comment: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type AssemblyDetail = {
  id: string
  number: string
  customerId: string
  customerName: string
  deviceId: string
  serialNumber: string
  deviceLabel: string
  deviceBrand: string
  deviceModel: string
  statusId: string
  statusCode: string
  statusName: string
  createdAt: string
  updatedAt: string
  conclusion: string
  completenessPct: number
  parts: AssemblyPart[]
}

export type AssemblyJournalEvent = {
  id: string
  eventType: string
  summary: string
  actorId: string | null
  actorName: string
  payload: Json
  createdAt: string
}

export type AssemblyAttachment = {
  id: string
  orderId: string
  kind: 'photo' | 'pdf' | 'url'
  filePath: string | null
  fileName: string | null
  mimeType: string | null
  fileSize: number | null
  url: string | null
  caption: string
  createdBy: string | null
  createdAt: string
  signedUrl?: string | null
}

export type AssemblyListFilters = {
  tab: AssemblyTab
  search: string
  page: number
  pageSize: number
}

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value
}

function asString(value: Json | undefined, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function mapListItem(row: {
  id: string
  number: string
  customer_id: string
  customer_name: string
  device_id: string
  serial_number: string
  device_label: string
  device_brand: string
  device_model: string
  status_id: string
  status_code: string
  status_name: string
  created_at: string
  updated_at: string
  completeness_pct: number
}): AssemblyListItem {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    deviceId: row.device_id,
    serialNumber: row.serial_number,
    deviceLabel: row.device_label,
    deviceBrand: row.device_brand,
    deviceModel: row.device_model,
    statusId: row.status_id,
    statusCode: row.status_code,
    statusName: row.status_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completenessPct: Number(row.completeness_pct ?? 0),
  }
}

function mapPart(row: Record<string, Json | undefined>): AssemblyPart {
  return {
    id: asString(row.id),
    name: asString(row.name),
    qtyRequired: asNumber(row.qty_required),
    qtyCollected: asNumber(row.qty_collected),
    comment: asString(row.comment),
    sortOrder: asNumber(row.sort_order),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function mapAttachment(row: OrderAssemblyAttachmentRow, signedUrl?: string | null): AssemblyAttachment {
  return {
    id: row.id,
    orderId: row.order_id,
    kind: row.kind,
    filePath: row.file_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    url: row.url,
    caption: row.caption,
    createdBy: row.created_by,
    createdAt: row.created_at,
    signedUrl: signedUrl ?? null,
  }
}

export async function listAssemblies(filters: AssemblyListFilters) {
  const { data, error } = await getSupabase().rpc('list_order_assemblies', {
    tab_filter: filters.tab,
    search_query: filters.search,
    page_number: filters.page,
    page_size: filters.pageSize,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить сборки заказов.')
  }

  const rows = data ?? []
  return {
    items: rows.map(mapListItem),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

export async function getAssembly(orderId: string): Promise<AssemblyDetail> {
  const { data, error } = await getSupabase().rpc('get_order_assembly', {
    target_order_id: orderId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить карточку сборки.')
  }

  const row = asRecord(data)
  if (!row || typeof row.id !== 'string') {
    throw toAppError(new Error('Сборка не найдена.'), 'Сборка не найдена.')
  }

  const partsRaw = Array.isArray(row.parts) ? row.parts : []
  const parts = partsRaw.flatMap((item) => {
    const part = asRecord(item)
    return part ? [mapPart(part)] : []
  })

  return {
    id: asString(row.id),
    number: asString(row.number),
    customerId: asString(row.customer_id),
    customerName: asString(row.customer_name),
    deviceId: asString(row.device_id),
    serialNumber: asString(row.serial_number),
    deviceLabel: asString(row.device_label),
    deviceBrand: asString(row.device_brand),
    deviceModel: asString(row.device_model),
    statusId: asString(row.status_id),
    statusCode: asString(row.status_code),
    statusName: asString(row.status_name),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    conclusion: asString(row.conclusion),
    completenessPct: asNumber(row.completeness_pct, calcCompletenessPct(parts)),
    parts,
  }
}

export type AssemblyPartSaveItem = {
  id: string | null
  name: string
  qty_required: number
  qty_collected: number
  comment: string
  sort_order: number
}

export type SaveAssemblyPartsResult = {
  completenessPct: number
  changed: boolean
  changesCount: number
}

/** Сохраняет весь список позиций одним вызовом и пишет одну запись в историю. */
export async function saveAssemblyParts(
  orderId: string,
  parts: AssemblyPartSaveItem[],
): Promise<SaveAssemblyPartsResult> {
  const { data, error } = await getSupabase().rpc('save_order_assembly_parts', {
    target_order_id: orderId,
    parts: parts as unknown as Json,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить сборку.')
  }

  const row = asRecord(data)
  return {
    completenessPct: asNumber(row?.completeness_pct, 0),
    changed: Boolean(row?.changed),
    changesCount: asNumber(row?.changes_count, 0),
  }
}

export async function addAssemblyPart(
  orderId: string,
  input: { name: string; qtyRequired?: number; qtyCollected?: number; comment?: string },
): Promise<string> {
  const { data, error } = await getSupabase().rpc('add_order_assembly_part', {
    target_order_id: orderId,
    part_name: input.name,
    part_qty_required: input.qtyRequired ?? 1,
    part_qty_collected: input.qtyCollected ?? 0,
    part_comment: input.comment ?? '',
  })

  if (error) {
    throw toAppError(error, 'Не удалось добавить позицию.')
  }

  return data
}

export async function updateAssemblyPart(
  partId: string,
  input: {
    name?: string
    qtyRequired?: number
    qtyCollected?: number
    comment?: string
  },
): Promise<void> {
  const { error } = await getSupabase().rpc('update_order_assembly_part', {
    target_part_id: partId,
    part_name: input.name ?? null,
    part_qty_required: input.qtyRequired ?? null,
    part_qty_collected: input.qtyCollected ?? null,
    part_comment: input.comment ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось обновить позицию.')
  }
}

export async function removeAssemblyPart(partId: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_order_assembly_part', {
    target_part_id: partId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить позицию.')
  }
}

export async function getAssemblyJournal(orderId: string): Promise<AssemblyJournalEvent[]> {
  const { data, error } = await getSupabase().rpc('get_order_assembly_journal', {
    target_order_id: orderId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить историю сборки.')
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    summary: row.summary,
    actorId: row.actor_id,
    actorName: row.actor_name,
    payload: row.payload,
    createdAt: row.created_at,
  }))
}

export async function addAssemblyJournalNote(orderId: string, body: string): Promise<void> {
  const { error } = await getSupabase().rpc('add_order_assembly_journal_note', {
    target_order_id: orderId,
    p_body: body,
  })

  if (error) {
    throw toAppError(error, 'Не удалось добавить событие.')
  }
}

export async function listAssemblyAttachments(orderId: string): Promise<AssemblyAttachment[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('order_assembly_attachments')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить файлы сборки.')
  }

  const rows = (data ?? []) as OrderAssemblyAttachmentRow[]
  return Promise.all(
    rows.map(async (row) => {
      if (row.kind === 'url' || !row.file_path) {
        return mapAttachment(row, row.url)
      }
      const { data: signed } = await supabase.storage
        .from(ASSEMBLY_ATTACHMENTS_BUCKET)
        .createSignedUrl(row.file_path, 3600)
      return mapAttachment(row, signed?.signedUrl ?? null)
    }),
  )
}

export async function addAssemblyAttachmentUrl(orderId: string, url: string, caption = ''): Promise<void> {
  const { error } = await getSupabase().rpc('add_order_assembly_attachment_url', {
    target_order_id: orderId,
    target_url: url,
    caption,
  })

  if (error) {
    throw toAppError(error, 'Не удалось добавить ссылку.')
  }
}

function resolveUploadMime(file: File): string {
  const type = file.type.trim().toLowerCase()
  if ((ASSEMBLY_FILE_MIME_TYPES as readonly string[]).includes(type)) {
    return type === 'image/jpg' ? 'image/jpeg' : type
  }

  const name = file.name.trim().toLowerCase()
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (name.endsWith('.png')) {
    return 'image/png'
  }
  if (name.endsWith('.webp')) {
    return 'image/webp'
  }
  if (name.endsWith('.pdf')) {
    return 'application/pdf'
  }

  throw toAppError(
    { message: 'Можно загрузить только фото или PDF.' },
    'Можно загрузить только фото или PDF.',
  )
}

export function validateAssemblyUploadFile(file: File): void {
  if (file.size > ASSEMBLY_FILE_MAX_BYTES) {
    throw toAppError({ message: 'Файл слишком большой.' }, 'Файл слишком большой.')
  }
  resolveUploadMime(file)
}

export async function uploadAssemblyFile(orderId: string, file: File, caption: string): Promise<void> {
  validateAssemblyUploadFile(file)
  const mimeType = resolveUploadMime(file)
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
  const path = `${orderId}/${crypto.randomUUID()}${extension}`
  const supabase = getSupabase()

  const { error: uploadError } = await supabase.storage.from(ASSEMBLY_ATTACHMENTS_BUCKET).upload(path, file, {
    contentType: mimeType,
    upsert: false,
  })

  if (uploadError) {
    throw toAppError(uploadError, 'Не удалось загрузить файл.')
  }

  const { error } = await supabase.rpc('register_order_assembly_file', {
    target_order_id: orderId,
    file_path: path,
    file_name: file.name,
    mime_type: mimeType,
    file_size: file.size,
    caption,
  })

  if (error) {
    throw toAppError(error, 'Не удалось зарегистрировать файл.')
  }
}

export async function deleteAssemblyAttachment(attachmentId: string, filePath: string | null): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.rpc('delete_order_assembly_attachment', {
    target_attachment_id: attachmentId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить файл.')
  }

  if (filePath) {
    await supabase.storage.from(ASSEMBLY_ATTACHMENTS_BUCKET).remove([filePath])
  }
}

export function assemblyJournalEventTypeLabel(eventType: string): string {
  switch (eventType) {
    case 'comment':
      return 'Комментарий'
    case 'attachment':
      return 'Файл'
    case 'task_created':
      return 'Задача'
    case 'task_completed':
      return 'Задача выполнена'
    case 'task_deleted':
      return 'Задача удалена'
    case 'assembly_updated':
      return 'Сборка'
    case 'assembly_part_added':
      return 'Позиция добавлена'
    case 'assembly_part_updated':
      return 'Позиция обновлена'
    case 'assembly_part_removed':
      return 'Позиция удалена'
    default:
      return 'Событие'
  }
}
