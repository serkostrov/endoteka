import { isAuditEntityId } from '@/lib/constants/audit'
import { routes } from '@/lib/constants/routes'
import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export type AuditEvent = {
  id: string
  actorUserId: string | null
  actorName: string
  actorEmail: string
  action: string
  entityType: string
  entityId: string | null
  metadata: Record<string, Json | undefined>
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

export type AuditListFilters = {
  search: string
  actorId: string
  entityType: string
  action: string
  fromDate: string
  toDate: string
  page: number
  pageSize: number
}

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value
}

function mapEvent(row: {
  id: string
  actor_id: string | null
  actor_name: string
  actor_email: string
  action: string
  entity_type: string
  entity_id: string | null
  metadata: Json
  ip_address: string | null
  user_agent: string | null
  created_at: string
}): AuditEvent {
  return {
    id: row.id,
    actorUserId: row.actor_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: asRecord(row.metadata),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }
}

export async function listAuditEvents(filters: AuditListFilters) {
  const actorId = filters.actorId !== 'all' && isAuditEntityId(filters.actorId) ? filters.actorId : null
  const entityType = filters.entityType === 'all' ? '' : filters.entityType
  const action = filters.action === 'all' ? '' : filters.action

  const { data, error } = await getSupabase().rpc('list_audit_events', {
    search_query: filters.search,
    actor_filter: actorId,
    entity_type_filter: entityType,
    action_filter: action,
    from_date: filters.fromDate || null,
    to_date: filters.toDate || null,
    page_number: filters.page,
    page_size: filters.pageSize,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить журнал действий.')
  }

  const rows = data ?? []
  return {
    items: rows.map(mapEvent),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

export function auditEntityHref(entityType: string, entityId: string | null): string | null {
  if (!isAuditEntityId(entityId)) {
    return null
  }

  if (entityType === 'order') {
    return routes.order.replace(':id', entityId)
  }
  if (entityType === 'sale') {
    return routes.sale.replace(':id', entityId)
  }
  if (entityType === 'inventory_item') {
    return routes.inventoryItem.replace(':id', entityId)
  }
  if (entityType === 'inventory_count') {
    return routes.inventoryCount.replace(':id', entityId)
  }
  if (entityType === 'document_template') {
    return routes.documentTemplate.replace(':id', entityId)
  }
  if (entityType === 'device') {
    return routes.device.replace(':id', entityId)
  }
  if (entityType === 'customer') {
    return routes.customer.replace(':id', entityId)
  }
  if (entityType === 'role') {
    return routes.role.replace(':id', entityId)
  }
  if (entityType === 'user') {
    return routes.users
  }
  if (entityType === 'invitation') {
    return routes.users
  }
  if (entityType === 'notification_rule') {
    return routes.settingsNotifications
  }
  if (entityType === 'order_transition') {
    return routes.settingsOrders
  }
  if (entityType === 'settings' || entityType === 'app_settings') {
    return routes.settings
  }

  return null
}
