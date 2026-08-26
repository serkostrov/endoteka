import {
  DeadlineState,
  isDeadlineState,
  ORDER_ATTACHMENTS_BUCKET,
  ORDER_FILE_MAX_BYTES,
  ORDER_FILE_MIME_TYPES,
} from '@/lib/constants/orders'
import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Json, OrderAttachmentRow, OrderListItemRow, OrderRow, OrderStatusCatalogRow, OrderStatusGroupRow } from '@/types/database'

import type { OrderStatusCatalogItem } from '../lib/status-catalog'

export type OrderSortColumn =
  | 'number'
  | 'client'
  | 'device'
  | 'serial'
  | 'status'
  | 'responsible'
  | 'deadline'
  | 'updated'

export type OrderListFilters = {
  search: string
  statusId: string
  responsibleId: string
  deadlineState: string
  activeOnly: boolean
  attentionOnly: boolean
  sort: OrderSortColumn
  direction: 'asc' | 'desc'
  page: number
  pageSize: number
}

export type OrderListItem = {
  id: string
  number: string
  numberSeq: number
  customerId: string
  customerName: string
  deviceId: string
  serialNumber: string
  deviceBrand: string
  deviceModel: string
  deviceLabel: string
  statusId: string
  statusCode: string
  statusName: string
  isTerminal: boolean
  responsibleId: string | null
  responsibleName: string
  deadline: string | null
  deadlineState: DeadlineState
  claimedMalfunction: string
  createdAt: string
  updatedAt: string
}

export type OrderListResult = {
  items: OrderListItem[]
  total: number
}

export type OrderDetail = OrderListItem & {
  completeness: string
  externalCondition: string
  createdBy: string | null
}

export type OrderTransition = {
  transitionId: string
  toStatusId: string
  toStatusCode: string
  toStatusName: string
  requiredPermission: string
  isAllowed: boolean
  blockReason: string | null
  groupCode: string | null
  groupName: string | null
  groupSortOrder: number
  color: string | null
  requiresWarranty: boolean
  isDestructive: boolean
}

export type OrderAttachment = {
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
  signedUrl: string | null
}

export type CreateOrderInput = {
  customerId: string
  deviceId: string
  claimedMalfunction: string
  completeness: string
  externalCondition: string
  deadline: string | null
  responsibleId: string | null
}

export type UpdateOrderInput = {
  orderId: string
  claimedMalfunction?: string
  completeness?: string
  externalCondition?: string
  deadline?: string | null
  changeDeadline?: boolean
  responsibleId?: string | null
  changeResponsible?: boolean
  customerId?: string | null
  changeCustomer?: boolean
  deviceId?: string | null
  changeDevice?: boolean
}

export type WorkflowTransition = {
  id: string
  fromStatusId: string
  toStatusId: string
  fromStatusName: string
  toStatusName: string
  requiredPermission: string
  isActive: boolean
  sortOrder: number
  ruleCodes: string[]
}

export type TransitionRuleType = {
  code: string
  name: string
  description: string | null
}

export type OrderAppSettings = {
  nextNumber: string
  start: number
  approachingDays: number
}

const SORT_COLUMNS: Record<OrderSortColumn, string> = {
  number: 'number_seq',
  client: 'customer_name',
  device: 'device_label',
  serial: 'serial_number',
  status: 'status_name',
  responsible: 'responsible_name',
  deadline: 'deadline',
  updated: 'updated_at',
}

function sanitizeSearch(value: string) {
  return value.replace(/[%_,]/g, '').trim()
}

function mapListItem(row: OrderListItemRow): OrderListItem {
  const deadlineState = isDeadlineState(row.deadline_state) ? row.deadline_state : DeadlineState.None

  return {
    id: row.id,
    number: row.number,
    numberSeq: row.number_seq,
    customerId: row.customer_id,
    customerName: row.customer_name,
    deviceId: row.device_id,
    serialNumber: row.serial_number,
    deviceBrand: row.device_brand,
    deviceModel: row.device_model,
    deviceLabel: row.device_label || row.serial_number,
    statusId: row.status_id,
    statusCode: row.status_code,
    statusName: row.status_name,
    isTerminal: row.is_terminal,
    responsibleId: row.responsible_id,
    responsibleName: row.responsible_name,
    deadline: row.deadline,
    deadlineState,
    claimedMalfunction: row.claimed_malfunction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAttachment(row: OrderAttachmentRow, signedUrl: string | null): OrderAttachment {
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
    signedUrl,
  }
}

export async function listOrders(filters: OrderListFilters): Promise<OrderListResult> {
  const supabase = getSupabase()
  const from = (filters.page - 1) * filters.pageSize
  const to = from + filters.pageSize - 1
  const column = SORT_COLUMNS[filters.sort] ?? 'updated_at'

  let query = supabase
    .from('order_list_items')
    .select('*', { count: 'exact' })
    .order(column, { ascending: filters.direction === 'asc', nullsFirst: false })

  const term = sanitizeSearch(filters.search)
  if (term) {
    query = query.or(
      `number.ilike.%${term}%,customer_name.ilike.%${term}%,serial_number.ilike.%${term}%,device_label.ilike.%${term}%`,
    )
  }

  if (filters.statusId !== 'all') {
    query = query.eq('status_id', filters.statusId)
  }

  if (filters.responsibleId === 'unassigned') {
    query = query.is('responsible_id', null)
  } else if (filters.responsibleId !== 'all') {
    query = query.eq('responsible_id', filters.responsibleId)
  }

  if (filters.deadlineState !== 'all') {
    query = query.eq('deadline_state', filters.deadlineState)
  }

  if (filters.attentionOnly) {
    query = query
      .eq('is_terminal', false)
      .or('deadline_state.eq.overdue,deadline_state.eq.approaching,status_code.eq.waiting_approval')
  } else if (filters.activeOnly) {
    query = query.eq('is_terminal', false)
  }

  const { data, error, count } = await query.range(from, to)

  if (error) {
    throw toAppError(error, 'Не удалось загрузить заказы.')
  }

  return {
    items: (data ?? []).map(mapListItem),
    total: count ?? 0,
  }
}

export async function getOrder(id: string): Promise<OrderDetail | null> {
  const supabase = getSupabase()
  const [listResult, orderResult] = await Promise.all([
    supabase.from('order_list_items').select('*').eq('id', id).maybeSingle(),
    supabase.from('orders').select('*').eq('id', id).maybeSingle(),
  ])

  if (listResult.error) {
    throw toAppError(listResult.error, 'Не удалось загрузить заказ.')
  }

  if (orderResult.error) {
    throw toAppError(orderResult.error, 'Не удалось загрузить заказ.')
  }

  if (!listResult.data || !orderResult.data) {
    return null
  }

  const order = orderResult.data as OrderRow
  return {
    ...mapListItem(listResult.data),
    completeness: order.completeness,
    externalCondition: order.external_condition,
    createdBy: order.created_by,
  }
}

export async function previewNextOrderNumber(): Promise<string> {
  const { data, error } = await getSupabase().rpc('preview_next_order_number')

  if (error) {
    throw toAppError(error, 'Не удалось получить номер заказа.')
  }

  return data ?? ''
}

export async function createOrder(input: CreateOrderInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_order', {
    target_customer_id: input.customerId,
    target_device_id: input.deviceId,
    claimed_malfunction: input.claimedMalfunction,
    completeness: input.completeness,
    external_condition: input.externalCondition,
    target_deadline: input.deadline,
    target_responsible_id: input.responsibleId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось создать заказ.')
  }

  return data
}

export async function updateOrder(input: UpdateOrderInput): Promise<void> {
  const { error } = await getSupabase().rpc('update_order', {
    target_order_id: input.orderId,
    claimed_malfunction: input.claimedMalfunction ?? null,
    completeness: input.completeness ?? null,
    external_condition: input.externalCondition ?? null,
    target_deadline: input.changeDeadline ? input.deadline ?? null : null,
    clear_deadline: Boolean(input.changeDeadline && input.deadline === null),
    target_responsible_id: input.changeResponsible ? (input.responsibleId ?? null) : null,
    change_responsible: Boolean(input.changeResponsible),
    target_customer_id: input.changeCustomer ? (input.customerId ?? null) : null,
    change_customer: Boolean(input.changeCustomer),
    target_device_id: input.changeDevice ? (input.deviceId ?? null) : null,
    change_device: Boolean(input.changeDevice),
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить заказ.')
  }
}

export async function changeOrderStatus(
  orderId: string,
  statusId: string,
  warranty?: { start: string; end: string } | null,
): Promise<void> {
  const { error } = await getSupabase().rpc('change_order_status', {
    target_order_id: orderId,
    target_status_id: statusId,
    warranty_start: warranty?.start ?? null,
    warranty_end: warranty?.end ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сменить статус.')
  }
}

export async function getAvailableOrderTransitions(orderId: string): Promise<OrderTransition[]> {
  const { data, error } = await getSupabase().rpc('get_available_order_transitions', {
    target_order_id: orderId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить доступные действия.')
  }

  return (data ?? []).map((row) => ({
    transitionId: row.transition_id,
    toStatusId: row.to_status_id,
    toStatusCode: row.to_status_code,
    toStatusName: row.to_status_name,
    requiredPermission: row.required_permission,
    isAllowed: row.is_allowed,
    blockReason: row.block_reason,
    groupCode: row.group_code ?? null,
    groupName: row.group_name ?? null,
    groupSortOrder: row.group_sort_order ?? 999,
    color: row.color ?? null,
    requiresWarranty: row.requires_warranty ?? false,
    isDestructive: row.is_destructive ?? false,
  }))
}

async function signedUrlFor(filePath: string | null) {
  if (!filePath) {
    return null
  }

  const { data, error } = await getSupabase()
    .storage
    .from(ORDER_ATTACHMENTS_BUCKET)
    .createSignedUrl(filePath, 3600)

  if (error) {
    return null
  }

  return data.signedUrl
}

export async function listOrderAttachments(orderId: string): Promise<OrderAttachment[]> {
  const { data, error } = await getSupabase()
    .from('order_attachments')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить вложения.')
  }

  return Promise.all((data ?? []).map(async (row) => mapAttachment(row, await signedUrlFor(row.file_path))))
}

export async function addOrderAttachmentUrl(orderId: string, url: string, caption: string): Promise<void> {
  const { error } = await getSupabase().rpc('add_order_attachment_url', {
    target_order_id: orderId,
    target_url: url,
    caption,
  })

  if (error) {
    throw toAppError(error, 'Не удалось добавить ссылку.')
  }
}

export function validateOrderUploadFile(file: File): void {
  if (file.size > ORDER_FILE_MAX_BYTES) {
    throw toAppError({ message: 'Файл больше 5 ГБ.' }, 'Файл больше 5 ГБ.')
  }

  if (!ORDER_FILE_MIME_TYPES.includes(file.type)) {
    throw toAppError({ message: 'Можно загрузить только фото или PDF.' }, 'Можно загрузить только фото или PDF.')
  }
}

export async function uploadOrderFile(orderId: string, file: File, caption: string): Promise<void> {
  validateOrderUploadFile(file)

  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
  const path = `${orderId}/${crypto.randomUUID()}${extension}`
  const supabase = getSupabase()
  const { error: uploadError } = await supabase.storage.from(ORDER_ATTACHMENTS_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })

  if (uploadError) {
    throw toAppError(uploadError, 'Не удалось загрузить файл.')
  }

  const { error } = await supabase.rpc('register_order_file', {
    target_order_id: orderId,
    file_path: path,
    file_name: file.name,
    mime_type: file.type,
    file_size: file.size,
    caption,
  })

  if (error) {
    throw toAppError(error, 'Не удалось зарегистрировать файл.')
  }
}

export async function getOrderAppSettings(): Promise<OrderAppSettings> {
  const supabase = getSupabase()
  const [preview, settingsResult] = await Promise.all([
    previewNextOrderNumber(),
    supabase.from('app_settings').select('key, value').in('key', ['order_number', 'deadline']),
  ])

  if (settingsResult.error) {
    throw toAppError(settingsResult.error, 'Не удалось загрузить настройки заказов.')
  }

  const byKey = new Map((settingsResult.data ?? []).map((row) => [row.key, row.value]))
  const numberValue = byKey.get('order_number')
  const deadlineValue = byKey.get('deadline')

  return {
    nextNumber: preview,
    start: readNumber(numberValue, 'start', 1),
    approachingDays: readNumber(deadlineValue, 'approaching_days', 2),
  }
}

function readNumber(value: Json | undefined, key: string, fallback: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }

  const raw = value[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
}

export async function setOrderNumberStart(nextStart: number): Promise<void> {
  const { error } = await getSupabase().rpc('set_order_number_start', { next_start: nextStart })

  if (error) {
    throw toAppError(error, 'Не удалось изменить начальный номер.')
  }
}

export async function processOrderDeadlines(): Promise<number> {
  const { data, error } = await getSupabase().rpc('process_order_deadline_notifications')

  if (error) {
    throw toAppError(error, 'Не удалось проверить сроки заказов.')
  }

  return data ?? 0
}

export async function listTransitionRuleTypes(): Promise<TransitionRuleType[]> {
  const { data, error } = await getSupabase()
    .from('transition_rule_types')
    .select('code, name, description')
    .order('name')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить правила переходов.')
  }

  return data ?? []
}

export async function listWorkflowTransitions(): Promise<WorkflowTransition[]> {
  const supabase = getSupabase()
  const [transitionsResult, rulesResult] = await Promise.all([
    supabase.from('order_status_transitions').select('*').order('sort_order').order('created_at'),
    supabase.from('order_transition_rules').select('transition_id, rule_code'),
  ])

  if (transitionsResult.error) {
    throw toAppError(transitionsResult.error, 'Не удалось загрузить маршрут статусов.')
  }

  if (rulesResult.error) {
    throw toAppError(rulesResult.error, 'Не удалось загрузить правила переходов.')
  }

  const rows = transitionsResult.data ?? []
  const statusIds = [...new Set(rows.flatMap((row) => [row.from_status_id, row.to_status_id]))]
  const { data: statuses, error: statusError } = await supabase
    .from('reference_items')
    .select('id, name')
    .in('id', statusIds)

  if (statusError) {
    throw toAppError(statusError, 'Не удалось загрузить маршрут статусов.')
  }

  const names = new Map((statuses ?? []).map((row) => [row.id, row.name]))
  const rulesByTransition = new Map<string, string[]>()
  for (const rule of rulesResult.data ?? []) {
    const list = rulesByTransition.get(rule.transition_id) ?? []
    list.push(rule.rule_code)
    rulesByTransition.set(rule.transition_id, list)
  }

  return rows.map((row) => ({
    id: row.id,
    fromStatusId: row.from_status_id,
    toStatusId: row.to_status_id,
    fromStatusName: names.get(row.from_status_id) ?? '',
    toStatusName: names.get(row.to_status_id) ?? '',
    requiredPermission: row.required_permission,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    ruleCodes: rulesByTransition.get(row.id) ?? [],
  }))
}

export async function upsertOrderTransition(input: {
  id?: string
  fromStatusId: string
  toStatusId: string
  requiredPermission: string
  ruleCodes: string[]
  isActive: boolean
}): Promise<void> {
  const { error } = await getSupabase().rpc('upsert_order_transition', {
    target_id: input.id ?? null,
    from_status_id: input.fromStatusId,
    to_status_id: input.toStatusId,
    required_permission: input.requiredPermission,
    rule_codes: input.ruleCodes,
    is_active: input.isActive,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить переход.')
  }
}

export async function deleteOrderTransition(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_order_transition', {
    target_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить переход.')
  }
}

export type OrderStatusGroupRecord = {
  id: string
  code: string
  name: string
  color: string
  sortOrder: number
}

function mapStatusCatalog(row: OrderStatusCatalogRow): OrderStatusCatalogItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    isSystem: row.is_system,
    sortOrder: row.sort_order,
    groupId: row.group_id,
    groupCode: row.group_code,
    groupName: row.group_name,
    groupSortOrder: row.group_sort_order,
    groupColor: row.group_color,
    color: row.color,
    isInitial: row.is_initial,
    isTerminal: row.is_terminal,
    notifiesWarehouse: row.notifies_warehouse,
    requiresWarranty: row.requires_warranty,
    isDestructive: row.is_destructive,
  }
}

export async function listOrderStatusCatalog(): Promise<OrderStatusCatalogItem[]> {
  const { data, error } = await getSupabase()
    .from('order_status_catalog')
    .select('*')
    .order('group_sort_order')
    .order('sort_order')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить статусы заказов.')
  }

  return (data ?? []).map(mapStatusCatalog)
}

export async function listOrderStatusGroups(): Promise<OrderStatusGroupRecord[]> {
  const { data, error } = await getSupabase()
    .from('order_status_groups')
    .select('*')
    .order('sort_order')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить группы статусов.')
  }

  return (data ?? []).map((row: OrderStatusGroupRow) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
  }))
}

export async function upsertOrderStatus(input: {
  id?: string
  code: string
  name: string
  groupId: string
  color?: string
  isInitial: boolean
  isTerminal: boolean
  notifiesWarehouse: boolean
  requiresWarranty: boolean
  isDestructive: boolean
  isActive: boolean
}): Promise<void> {
  const { error } = await getSupabase().rpc('upsert_order_status', {
    target_id: input.id ?? null,
    item_code: input.code,
    item_name: input.name,
    target_group_id: input.groupId,
    item_color: input.color ?? '',
    p_initial: input.isInitial,
    p_terminal: input.isTerminal,
    p_warehouse: input.notifiesWarehouse,
    p_warranty: input.requiresWarranty,
    p_destructive: input.isDestructive,
    p_active: input.isActive,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить статус.')
  }
}

export async function deleteOrderStatus(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_order_status', { target_id: id })
  if (error) {
    throw toAppError(error, 'Не удалось удалить статус.')
  }
}

export async function upsertOrderStatusGroup(input: {
  id?: string
  code: string
  name: string
  color: string
}): Promise<void> {
  const { error } = await getSupabase().rpc('upsert_order_status_group', {
    target_id: input.id ?? null,
    group_code: input.code,
    group_name: input.name,
    group_color: input.color,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить группу.')
  }
}

export async function deleteOrderStatusGroup(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_order_status_group', { target_id: id })
  if (error) {
    throw toAppError(error, 'Не удалось удалить группу.')
  }
}

export async function reorderOrderStatusGroups(groupIds: string[]): Promise<void> {
  const { error } = await getSupabase().rpc('reorder_order_status_groups', {
    group_ids: groupIds,
  })
  if (error) {
    throw toAppError(error, 'Не удалось сохранить порядок групп.')
  }
}

export async function reorderOrderStatuses(itemIds: string[]): Promise<void> {
  const { error } = await getSupabase().rpc('reorder_order_statuses', {
    item_ids: itemIds,
  })
  if (error) {
    throw toAppError(error, 'Не удалось сохранить порядок статусов.')
  }
}
