export const AUDIT_PAGE_SIZE = 50
export const AUDIT_SEARCH_DEBOUNCE_MS = 300

export const AuditEntityType = {
  Order: 'order',
  InventoryReceipt: 'inventory_receipt',
  InventorySale: 'inventory_sale',
  InventoryAdjustment: 'inventory_adjustment',
  InventoryItem: 'inventory_item',
  InventoryCount: 'inventory_count',
  Sale: 'sale',
  User: 'user',
  Invitation: 'invitation',
  Role: 'role',
  DocumentTemplate: 'document_template',
  Settings: 'settings',
  AppSettings: 'app_settings',
  NotificationRule: 'notification_rule',
  OrderTransition: 'order_transition',
  ReferenceItem: 'reference_item',
  DynamicField: 'dynamic_field',
  Device: 'device',
  Customer: 'customer',
  Session: 'session',
} as const

export type AuditEntityType = (typeof AuditEntityType)[keyof typeof AuditEntityType]

export const auditEntityTypeLabels: Record<AuditEntityType, string> = {
  order: 'Заказ',
  inventory_receipt: 'Приход',
  inventory_sale: 'Продажа со склада',
  inventory_adjustment: 'Корректировка склада',
  inventory_item: 'Номенклатура',
  inventory_count: 'Инвентаризация',
  sale: 'Продажа',
  user: 'Пользователь',
  invitation: 'Приглашение',
  role: 'Роль',
  document_template: 'Шаблон',
  settings: 'Настройки',
  app_settings: 'Настройки приложения',
  notification_rule: 'Правило уведомлений',
  order_transition: 'Переход статуса',
  reference_item: 'Справочник',
  dynamic_field: 'Динамическое поле',
  device: 'Прибор',
  customer: 'Клиент',
  session: 'Сессия',
}

export const auditEntityTypeFilterOptions: { value: string; label: string }[] = [
  { value: 'all', label: 'Все объекты' },
  ...Object.values(AuditEntityType).map((value) => ({
    value,
    label: auditEntityTypeLabels[value],
  })),
]

export const auditActionLabels: Record<string, string> = {
  'orders.created': 'Заказ создан',
  'orders.updated': 'Заказ изменён',
  'orders.status_changed': 'Смена статуса заказа',
  'orders.assigned': 'Назначение ответственного',
  'orders.diagnostics_saved': 'Диагностика сохранена',
  'orders.diagnostics_created': 'Диагностика создана',
  'orders.diagnostics_updated': 'Диагностика обновлена',
  'orders.number_start_changed': 'Изменена нумерация заказов',
  'orders.transition_saved': 'Изменён переход статуса',
  'orders.transition_deleted': 'Переход статуса удалён',
  'inventory.received': 'Приход на склад',
  'inventory.consumed_repair': 'Списание в ремонт',
  'inventory.sold': 'Продажа со склада',
  'inventory.adjusted': 'Корректировка остатка',
  'inventory.item_created': 'Номенклатура создана',
  'inventory.item_updated': 'Номенклатура изменена',
  'inventory.count_started': 'Инвентаризация начата',
  'inventory.count_cancelled': 'Инвентаризация отменена',
  'inventory.count_completed': 'Инвентаризация проведена',
  'inventory.count_deleted': 'Инвентаризация удалена',
  'sale.created': 'Продажа создана',
  'sale.confirmed': 'Продажа подтверждена',
  'sale.cancelled': 'Продажа отменена',
  'users.invited': 'Пользователь приглашён',
  'users.invite_failed': 'Приглашение не удалось',
  'users.invite_accepted': 'Приглашение принято',
  'users.role_changed': 'Изменена роль пользователя',
  'users.updated': 'Пользователь изменён',
  'users.activated': 'Пользователь включён',
  'users.deactivated': 'Пользователь отключён',
  'users.deleted': 'Пользователь удалён',
  'users.password_changed': 'Изменён пароль пользователя',
  'roles.permissions_changed': 'Изменены права роли',
  'document.template_created': 'Шаблон создан',
  'document.template_updated': 'Шаблон изменён',
  'document.template_deactivated': 'Шаблон деактивирован',
  'document.template_deleted': 'Шаблон удалён',
  'notifications.channels_saved': 'Изменены каналы уведомлений',
  'notifications.rule_saved': 'Правило уведомлений сохранено',
  'notifications.rule_deleted': 'Правило уведомлений удалено',
  'references.item_created': 'Запись справочника создана',
  'references.item_updated': 'Запись справочника изменена',
  'references.item_activated': 'Запись справочника включена',
  'references.item_deactivated': 'Запись справочника отключена',
  'references.item_deleted': 'Запись справочника удалена',
  'fields.created': 'Поле создано',
  'fields.updated': 'Поле изменено',
  'fields.activated': 'Поле включено',
  'fields.deactivated': 'Поле отключено',
  'fields.deleted': 'Поле удалено',
  'devices.created': 'Прибор создан',
  'devices.updated': 'Прибор изменён',
  'customers.created': 'Клиент создан',
  'auth.signed_in': 'Вход в систему',
  'auth.signed_out': 'Выход из системы',
  'auth.password_updated': 'Пароль изменён',
}

export const auditActionFilterGroups: { label: string; actions: string[] }[] = [
  {
    label: 'Заказы',
    actions: [
      'orders.created',
      'orders.updated',
      'orders.status_changed',
      'orders.assigned',
      'orders.diagnostics_created',
      'orders.diagnostics_updated',
      'orders.diagnostics_saved',
    ],
  },
  {
    label: 'Склад',
    actions: [
      'inventory.received',
      'inventory.consumed_repair',
      'inventory.sold',
      'inventory.adjusted',
      'inventory.item_created',
      'inventory.item_updated',
      'inventory.count_started',
      'inventory.count_completed',
      'inventory.count_cancelled',
      'inventory.count_deleted',
    ],
  },
  {
    label: 'Продажи',
    actions: ['sale.created', 'sale.confirmed', 'sale.cancelled'],
  },
  {
    label: 'Пользователи и права',
    actions: [
      'users.invited',
      'users.invite_accepted',
      'users.invite_failed',
      'users.role_changed',
      'users.updated',
      'users.activated',
      'users.deactivated',
      'users.deleted',
      'users.password_changed',
      'roles.permissions_changed',
    ],
  },
  {
    label: 'Настройки',
    actions: [
      'orders.number_start_changed',
      'orders.transition_saved',
      'orders.transition_deleted',
      'notifications.channels_saved',
      'notifications.rule_saved',
      'notifications.rule_deleted',
      'references.item_created',
      'references.item_updated',
      'references.item_activated',
      'references.item_deactivated',
      'references.item_deleted',
      'fields.created',
      'fields.updated',
      'fields.activated',
      'fields.deactivated',
      'fields.deleted',
    ],
  },
  {
    label: 'Шаблоны',
    actions: [
      'document.template_created',
      'document.template_updated',
      'document.template_deactivated',
      'document.template_deleted',
    ],
  },
  {
    label: 'Прочее',
    actions: [
      'devices.created',
      'devices.updated',
      'customers.created',
      'auth.signed_in',
      'auth.signed_out',
      'auth.password_updated',
    ],
  },
]

export const auditMetadataKeyLabels: Record<string, string> = {
  number: 'Номер',
  name: 'Название',
  email: 'Email',
  serial: 'Серийный номер',
  supplier: 'Поставщик',
  lines: 'Позиций',
  item_id: 'Номенклатура',
  quantity: 'Количество',
  quantity_delta: 'Изменение количества',
  invoice_number: 'Накладная',
  total: 'Сумма',
  user_id: 'Пользователь',
  is_active: 'Активен',
  previous_codes: 'Права до изменения',
  codes: 'Права после изменения',
  previous_responsible_id: 'Ответственный до',
  responsible_id: 'Ответственный',
  previous_role_id: 'Роль до',
  previous_role_code: 'Код роли до',
  role_id: 'Роль',
  role_code: 'Код роли',
  start: 'Начальный номер',
  event_code: 'Событие',
  target_kind: 'Получатель',
  set_id: 'Справочник',
  code: 'Код',
  entity_code: 'Раздел',
  field_type: 'Тип поля',
  changes: 'Изменения',
  reason: 'Причина',
}

export function auditActionLabel(action: string) {
  return auditActionLabels[action] ?? action
}

export function auditEntityTypeLabel(entityType: string) {
  if (entityType in auditEntityTypeLabels) {
    return auditEntityTypeLabels[entityType as AuditEntityType]
  }
  return entityType
}

export function auditMetadataKeyLabel(key: string) {
  return auditMetadataKeyLabels[key] ?? key
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isAuditEntityId(value: string | null | undefined): value is string {
  return Boolean(value && uuidPattern.test(value))
}
