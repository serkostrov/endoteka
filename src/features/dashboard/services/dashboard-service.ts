import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export type DashboardOrderPreview = {
  id: string
  number: string
  customerName: string
  statusCode: string
  statusName: string
  deadline: string | null
  deadlineState: string
  responsibleName: string
}

export type DashboardTaskPreview = {
  id: string
  title: string
  dueDate: string | null
  priority: string
  orderNumber: string
}

export type DashboardNotificationPreview = {
  id: string
  title: string
  body: string
  entityType: string | null
  entityId: string | null
  createdAt: string
}

export type DashboardStockPreview = {
  id: string
  name: string
  code: string
  stockQuantity: number
}

export type OperationalDashboard = {
  canOrders: boolean
  canTasks: boolean
  canInventory: boolean
  canNotifications: boolean
  canDiagnostics: boolean
  orders: {
    active: number
    attention: number
    overdue: number
    approaching: number
    waitingApproval: number
    repair: number
    diagnostics: number
    mineActive: number
    mineOverdue: number
    mineDiagnostics: number
    overdueItems: DashboardOrderPreview[]
    mineItems: DashboardOrderPreview[]
    repairItems: DashboardOrderPreview[]
  }
  tasks: {
    open: number
    mineOpen: number
    mineToday: number
    mineOverdue: number
    mineItems: DashboardTaskPreview[]
  }
  notifications: {
    unread: number
    items: DashboardNotificationPreview[]
  }
  inventory: {
    zeroStock: number
    items: DashboardStockPreview[]
  }
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

function asStringOrNull(value: Json | undefined) {
  return typeof value === 'string' && value !== '' ? value : null
}

function asBoolean(value: Json | undefined) {
  return value === true
}

function asNumber(value: Json | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 0
}

function asArray(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : []
}

function mapOrderPreview(value: Json): DashboardOrderPreview | null {
  const row = asRecord(value)
  if (!row) {
    return null
  }
  const id = asString(row.id)
  if (!id) {
    return null
  }
  return {
    id,
    number: asString(row.number),
    customerName: asString(row.customer_name),
    statusCode: asString(row.status_code),
    statusName: asString(row.status_name),
    deadline: asStringOrNull(row.deadline),
    deadlineState: asString(row.deadline_state),
    responsibleName: asString(row.responsible_name),
  }
}

function mapTaskPreview(value: Json): DashboardTaskPreview | null {
  const row = asRecord(value)
  if (!row) {
    return null
  }
  const id = asString(row.id)
  if (!id) {
    return null
  }
  return {
    id,
    title: asString(row.title),
    dueDate: asStringOrNull(row.due_date),
    priority: asString(row.priority),
    orderNumber: asString(row.order_number),
  }
}

function mapNotificationPreview(value: Json): DashboardNotificationPreview | null {
  const row = asRecord(value)
  if (!row) {
    return null
  }
  const id = asString(row.id)
  if (!id) {
    return null
  }
  return {
    id,
    title: asString(row.title),
    body: asString(row.body),
    entityType: asStringOrNull(row.entity_type),
    entityId: asStringOrNull(row.entity_id),
    createdAt: asString(row.created_at),
  }
}

function mapStockPreview(value: Json): DashboardStockPreview | null {
  const row = asRecord(value)
  if (!row) {
    return null
  }
  const id = asString(row.id)
  if (!id) {
    return null
  }
  return {
    id,
    name: asString(row.name),
    code: asString(row.code),
    stockQuantity: asNumber(row.stock_quantity),
  }
}

const emptyOrders: OperationalDashboard['orders'] = {
  active: 0,
  attention: 0,
  overdue: 0,
  approaching: 0,
  waitingApproval: 0,
  repair: 0,
  diagnostics: 0,
  mineActive: 0,
  mineOverdue: 0,
  mineDiagnostics: 0,
  overdueItems: [],
  mineItems: [],
  repairItems: [],
}

const emptyTasks: OperationalDashboard['tasks'] = {
  open: 0,
  mineOpen: 0,
  mineToday: 0,
  mineOverdue: 0,
  mineItems: [],
}

const emptyNotifications: OperationalDashboard['notifications'] = {
  unread: 0,
  items: [],
}

const emptyInventory: OperationalDashboard['inventory'] = {
  zeroStock: 0,
  items: [],
}

export async function getOperationalDashboard(): Promise<OperationalDashboard> {
  const { data, error } = await getSupabase().rpc('get_operational_dashboard')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить рабочий стол.')
  }

  const root = asRecord(data)
  const orders = asRecord(root?.orders)
  const tasks = asRecord(root?.tasks)
  const notifications = asRecord(root?.notifications)
  const inventory = asRecord(root?.inventory)

  return {
    canOrders: asBoolean(root?.can_orders),
    canTasks: asBoolean(root?.can_tasks),
    canInventory: asBoolean(root?.can_inventory),
    canNotifications: asBoolean(root?.can_notifications),
    canDiagnostics: asBoolean(root?.can_diagnostics),
    orders: orders
      ? {
          active: asNumber(orders.active),
          attention: asNumber(orders.attention),
          overdue: asNumber(orders.overdue),
          approaching: asNumber(orders.approaching),
          waitingApproval: asNumber(orders.waiting_approval),
          repair: asNumber(orders.repair),
          diagnostics: asNumber(orders.diagnostics),
          mineActive: asNumber(orders.mine_active),
          mineOverdue: asNumber(orders.mine_overdue),
          mineDiagnostics: asNumber(orders.mine_diagnostics),
          overdueItems: asArray(orders.overdue_items).map(mapOrderPreview).filter((item) => item !== null),
          mineItems: asArray(orders.mine_items).map(mapOrderPreview).filter((item) => item !== null),
          repairItems: asArray(orders.repair_items).map(mapOrderPreview).filter((item) => item !== null),
        }
      : emptyOrders,
    tasks: tasks
      ? {
          open: asNumber(tasks.open),
          mineOpen: asNumber(tasks.mine_open),
          mineToday: asNumber(tasks.mine_today),
          mineOverdue: asNumber(tasks.mine_overdue),
          mineItems: asArray(tasks.mine_items).map(mapTaskPreview).filter((item) => item !== null),
        }
      : emptyTasks,
    notifications: notifications
      ? {
          unread: asNumber(notifications.unread),
          items: asArray(notifications.items).map(mapNotificationPreview).filter((item) => item !== null),
        }
      : emptyNotifications,
    inventory: inventory
      ? {
          zeroStock: asNumber(inventory.zero_stock),
          items: asArray(inventory.items).map(mapStockPreview).filter((item) => item !== null),
        }
      : emptyInventory,
  }
}
