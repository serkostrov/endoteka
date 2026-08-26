import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export type NotificationItem = {
  id: string
  eventCode: string
  title: string
  body: string
  entityType: string | null
  entityId: string | null
  isRead: boolean
  createdAt: string
}

export type NotificationRule = {
  id: string
  eventCode: string
  targetKind: 'role' | 'responsible' | 'assignee'
  roleId: string | null
  roleName: string
  channelInApp: boolean
  channelEmail: boolean
  channelTelegram: boolean
  isActive: boolean
}

export type NotificationChannelSettings = {
  emailEnabled: boolean
  fromName: string
  fromEmail: string
  telegramEnabled: boolean
  telegramBotUsername: string
}

export type NotificationFailedDelivery = {
  id: string
  channel: string
  status: string
  error: string
  attempts: number
  title: string
  recipientName: string
  createdAt: string
}

export type NotificationAdmin = {
  events: { code: string; name: string; description: string }[]
  roles: { id: string; code: string; name: string }[]
  rules: NotificationRule[]
  channels: NotificationChannelSettings
  failedDeliveries: NotificationFailedDelivery[]
}

export type TelegramLink = {
  botUsername: string
  telegramEnabled: boolean
  linked: boolean
  telegramUsername: string
  pendingCode: string
  pendingExpiresAt: string | null
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

function asBoolean(value: Json | undefined) {
  return value === true
}

function asArray(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : []
}

export async function listMyNotifications(): Promise<NotificationItem[]> {
  const { data, error } = await getSupabase().rpc('list_my_notifications', { page_size: 30 })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить уведомления.')
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    eventCode: row.event_code,
    title: row.title,
    body: row.body,
    entityType: row.entity_type,
    entityId: row.entity_id,
    isRead: row.is_read,
    createdAt: row.created_at,
  }))
}

export async function countUnreadNotifications(): Promise<number> {
  const { data, error } = await getSupabase().rpc('count_unread_notifications')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить число уведомлений.')
  }

  return Number(data ?? 0)
}

export async function markNotificationsRead(): Promise<void> {
  const { error } = await getSupabase().rpc('mark_notifications_read')

  if (error) {
    throw toAppError(error, 'Не удалось отметить уведомления.')
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('mark_notification_read', {
    target_notification_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось отметить уведомление.')
  }
}

function mapRule(row: Record<string, Json | undefined>): NotificationRule {
  const kind = asString(row.target_kind)
  return {
    id: asString(row.id),
    eventCode: asString(row.event_code),
    targetKind: kind === 'role' || kind === 'assignee' ? kind : 'responsible',
    roleId: typeof row.role_id === 'string' ? row.role_id : null,
    roleName: asString(row.role_name),
    channelInApp: asBoolean(row.channel_in_app),
    channelEmail: asBoolean(row.channel_email),
    channelTelegram: asBoolean(row.channel_telegram),
    isActive: asBoolean(row.is_active),
  }
}

function mapChannels(value: Json | undefined): NotificationChannelSettings {
  const row = asRecord(value)
  return {
    emailEnabled: asBoolean(row?.email_enabled),
    fromName: asString(row?.from_name, 'Эндотека'),
    fromEmail: asString(row?.from_email),
    telegramEnabled: asBoolean(row?.telegram_enabled),
    telegramBotUsername: asString(row?.telegram_bot_username),
  }
}

export async function getNotificationAdmin(): Promise<NotificationAdmin> {
  const { data, error } = await getSupabase().rpc('list_notification_admin')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить настройки уведомлений.')
  }

  const row = asRecord(data)
  return {
    events: asArray(row?.events).flatMap((item) => {
      const event = asRecord(item)
      if (!event) {
        return []
      }
      return [{ code: asString(event.code), name: asString(event.name), description: asString(event.description) }]
    }),
    roles: asArray(row?.roles).flatMap((item) => {
      const role = asRecord(item)
      if (!role || typeof role.id !== 'string') {
        return []
      }
      return [{ id: role.id, code: asString(role.code), name: asString(role.name) }]
    }),
    rules: asArray(row?.rules).flatMap((item) => {
      const rule = asRecord(item)
      return rule ? [mapRule(rule)] : []
    }),
    channels: mapChannels(row?.channels),
    failedDeliveries: asArray(row?.failed_deliveries).flatMap((item) => {
      const delivery = asRecord(item)
      if (!delivery || typeof delivery.id !== 'string') {
        return []
      }
      return [
        {
          id: delivery.id,
          channel: asString(delivery.channel),
          status: asString(delivery.status),
          error: asString(delivery.error),
          attempts: Number(delivery.attempts ?? 0),
          title: asString(delivery.title),
          recipientName: asString(delivery.recipient_name),
          createdAt: asString(delivery.created_at),
        },
      ]
    }),
  }
}

export async function upsertNotificationRule(input: {
  id: string | null
  eventCode: string
  targetKind: NotificationRule['targetKind']
  roleId: string | null
  channelInApp: boolean
  channelEmail: boolean
  channelTelegram: boolean
  isActive: boolean
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('upsert_notification_rule', {
    target_id: input.id,
    p_event_code: input.eventCode,
    p_target_kind: input.targetKind,
    p_role_id: input.roleId,
    p_channel_in_app: input.channelInApp,
    p_channel_email: input.channelEmail,
    p_channel_telegram: input.channelTelegram,
    p_is_active: input.isActive,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить правило.')
  }

  return data
}

export async function deleteNotificationRule(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_notification_rule', { target_id: id })

  if (error) {
    throw toAppError(error, 'Не удалось удалить правило.')
  }
}

export async function saveNotificationChannelSettings(input: NotificationChannelSettings): Promise<void> {
  const { error } = await getSupabase().rpc('save_notification_channel_settings', {
    p_email_enabled: input.emailEnabled,
    p_from_name: input.fromName,
    p_from_email: input.fromEmail,
    p_telegram_enabled: input.telegramEnabled,
    p_telegram_bot_username: input.telegramBotUsername,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить каналы.')
  }
}

function mapTelegram(value: Json | null): TelegramLink {
  const row = asRecord(value)
  return {
    botUsername: asString(row?.bot_username),
    telegramEnabled: asBoolean(row?.telegram_enabled),
    linked: asBoolean(row?.linked),
    telegramUsername: asString(row?.telegram_username),
    pendingCode: asString(row?.pending_code),
    pendingExpiresAt: typeof row?.pending_expires_at === 'string' ? row.pending_expires_at : null,
  }
}

export async function getMyTelegramLink(): Promise<TelegramLink> {
  const { data, error } = await getSupabase().rpc('get_my_telegram_link')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить привязку Telegram.')
  }

  return mapTelegram(data)
}

export async function createTelegramLinkCode(): Promise<TelegramLink> {
  const { data, error } = await getSupabase().rpc('create_telegram_link_code')

  if (error) {
    throw toAppError(error, 'Не удалось получить код Telegram.')
  }

  return mapTelegram(data)
}

export async function unlinkTelegram(): Promise<void> {
  const { error } = await getSupabase().rpc('unlink_telegram')

  if (error) {
    throw toAppError(error, 'Не удалось отвязать Telegram.')
  }
}
