import { isTaskPriority, type TaskPriority } from '@/lib/constants/tasks'
import { toAppError } from '@/lib/errors'
import { formatDate, formatDateTime, toDate, toLocalDateTimeValue } from '@/lib/utils/date'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export type TaskListItem = {
  id: string
  title: string
  body: string
  assigneeId: string | null
  assigneeName: string
  dueDate: string | null
  priority: TaskPriority
  completed: boolean
  orderId: string | null
  orderNumber: string
  customerName: string
  createdBy: string | null
  createdByName: string
  createdAt: string
  completedAt: string | null
}

export type Task = TaskListItem

export type TaskListFilters = {
  search: string
  assigneeId: string
  status: string
  priority: string
  due: string
  linked: string
  orderId?: string | null
  page: number
  pageSize: number
}

export type CreateTaskInput = {
  title: string
  body: string
  assigneeId: string | null
  dueDate: string | null
  priority: TaskPriority
  orderId: string | null
}

export type UpdateTaskInput = {
  title: string
  body: string
  assigneeId: string | null
  dueDate: string | null
  priority: TaskPriority
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

function mapPriority(value: string): TaskPriority {
  return isTaskPriority(value) ? value : 'normal'
}

function mapDueDate(value: string | null | undefined) {
  if (!value) {
    return null
  }
  const date = toDate(value)
  return date ? toLocalDateTimeValue(date) : null
}

function mapListItem(row: {
  id: string
  title: string
  body?: string
  assignee_id: string | null
  assignee_name: string
  due_date: string | null
  priority: string
  completed: boolean
  order_id: string | null
  order_number: string
  customer_name?: string
  created_by: string | null
  created_by_name: string
  created_at: string
  completed_at: string | null
}): TaskListItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    dueDate: mapDueDate(row.due_date),
    priority: mapPriority(row.priority),
    completed: row.completed,
    orderId: row.order_id,
    orderNumber: row.order_number,
    customerName: row.customer_name ?? '',
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

function mapTask(row: Record<string, Json | undefined>): Task {
  return {
    id: asString(row.id),
    title: asString(row.title),
    body: asString(row.body),
    assigneeId: typeof row.assignee_id === 'string' ? row.assignee_id : null,
    assigneeName: asString(row.assignee_name),
    dueDate: mapDueDate(typeof row.due_date === 'string' ? row.due_date : null),
    priority: mapPriority(asString(row.priority, 'normal')),
    completed: asBoolean(row.completed),
    orderId: typeof row.order_id === 'string' ? row.order_id : null,
    orderNumber: asString(row.order_number),
    customerName: asString(row.customer_name),
    createdBy: typeof row.created_by === 'string' ? row.created_by : null,
    createdByName: asString(row.created_by_name),
    createdAt: asString(row.created_at),
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
  }
}

export async function listTasks(filters: TaskListFilters) {
  const { data, error } = await getSupabase().rpc('list_tasks', {
    search_query: filters.search,
    assignee_filter: filters.assigneeId,
    status_filter: filters.status,
    priority_filter: filters.priority,
    due_filter: filters.due,
    linked_filter: filters.linked,
    order_id_filter: filters.orderId ?? null,
    page_number: filters.page,
    page_size: filters.pageSize,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить задачи.')
  }

  const rows = data ?? []
  return {
    items: rows.map(mapListItem),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

export async function getTask(id: string): Promise<Task> {
  const { data, error } = await getSupabase().rpc('get_task', {
    target_task_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить задачу.')
  }

  const row = asRecord(data)
  if (!row || typeof row.id !== 'string') {
    throw toAppError(new Error('Задача не найдена.'), 'Задача не найдена.')
  }

  return mapTask(row)
}

export async function countOpenTasks(): Promise<number> {
  const { data, error } = await getSupabase().rpc('count_open_tasks')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить число задач.')
  }

  return Number(data ?? 0)
}

export async function createTask(input: CreateTaskInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_task', {
    p_title: input.title,
    p_body: input.body,
    p_assignee_id: input.assigneeId,
    p_due_date: input.dueDate,
    p_priority: input.priority,
    p_order_id: input.orderId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось создать задачу.')
  }

  return data
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<void> {
  const { error } = await getSupabase().rpc('update_task', {
    target_task_id: id,
    p_title: input.title,
    p_body: input.body,
    p_assignee_id: input.assigneeId,
    p_due_date: input.dueDate,
    p_priority: input.priority,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить задачу.')
  }
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_task', {
    target_task_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить задачу.')
  }
}

export async function setTaskCompleted(id: string, completed: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('set_task_completed', {
    target_task_id: id,
    p_completed: completed,
  })

  if (error) {
    throw toAppError(error, 'Не удалось изменить статус задачи.')
  }
}

export function formatTaskDueDate(value: string) {
  const date = toDate(value)
  if (!date) {
    return '—'
  }
  if (date.getHours() === 0 && date.getMinutes() === 0 && !value.includes('T') && value.length <= 10) {
    return formatDate(date)
  }
  return formatDateTime(date)
}

export function isTaskOverdue(dueDate: string | null, completed: boolean) {
  if (!dueDate || completed) {
    return false
  }
  const date = toDate(dueDate)
  return Boolean(date && date.getTime() < Date.now())
}

export function isTaskDueToday(dueDate: string | null, completed: boolean) {
  if (!dueDate || completed) {
    return false
  }
  const date = toDate(dueDate)
  if (!date) {
    return false
  }
  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

export function taskDueHint(dueDate: string | null, completed: boolean) {
  if (!dueDate) {
    return null
  }

  const date = toDate(dueDate)
  if (!date) {
    return null
  }

  const label = formatTaskDueDate(dueDate)
  const days = calendarDayDiff(date, new Date())

  if (completed) {
    return { label, tone: 'muted' as const }
  }

  if (isTaskOverdue(dueDate, false) && days < 0) {
    return { label: `${label} (−${Math.abs(days)} дн.)`, tone: 'danger' as const }
  }

  if (isTaskOverdue(dueDate, false)) {
    return { label: `${label} · просрочено`, tone: 'danger' as const }
  }

  if (days === 0) {
    return { label: `${label} · сегодня`, tone: 'warning' as const }
  }

  return { label, tone: 'muted' as const }
}

function calendarDayDiff(left: Date, right: Date) {
  const start = Date.UTC(left.getFullYear(), left.getMonth(), left.getDate())
  const end = Date.UTC(right.getFullYear(), right.getMonth(), right.getDate())
  return Math.round((start - end) / 86_400_000)
}
