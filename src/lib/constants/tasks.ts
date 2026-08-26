export const TaskPriority = {
  Low: 'low',
  Normal: 'normal',
  High: 'high',
} as const

export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority]

export const taskPriorityLabels: Record<TaskPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
}

export function isTaskPriority(value: string): value is TaskPriority {
  return value in taskPriorityLabels
}

export function taskPriorityTone(priority: TaskPriority) {
  if (priority === TaskPriority.High) {
    return 'danger' as const
  }
  if (priority === TaskPriority.Low) {
    return 'neutral' as const
  }
  return 'info' as const
}

export const TaskStatusFilter = {
  Open: 'open',
  Completed: 'completed',
  All: 'all',
} as const

export type TaskStatusFilter = (typeof TaskStatusFilter)[keyof typeof TaskStatusFilter]

export const taskStatusFilterLabels: Record<TaskStatusFilter, string> = {
  open: 'Открытые',
  completed: 'Выполненные',
  all: 'Все',
}

export const TaskDueFilter = {
  All: 'all',
  Overdue: 'overdue',
  Today: 'today',
  Upcoming: 'upcoming',
  None: 'none',
} as const

export type TaskDueFilter = (typeof TaskDueFilter)[keyof typeof TaskDueFilter]

export const taskDueFilterLabels: Record<TaskDueFilter, string> = {
  all: 'Все сроки',
  overdue: 'Просроченные',
  today: 'Сегодня',
  upcoming: 'Предстоящие',
  none: 'Без срока',
}

export const TaskLinkedFilter = {
  All: 'all',
  With: 'with',
  None: 'none',
} as const

export type TaskLinkedFilter = (typeof TaskLinkedFilter)[keyof typeof TaskLinkedFilter]

export const taskLinkedFilterLabels: Record<TaskLinkedFilter, string> = {
  all: 'Все заказы',
  with: 'С заказом',
  none: 'Без заказа',
}

export const TaskJournalEvent = {
  Created: 'task_created',
  Completed: 'task_completed',
  Deleted: 'task_deleted',
} as const

export type TaskJournalEvent = (typeof TaskJournalEvent)[keyof typeof TaskJournalEvent]

export const TASK_ASSIGNEE_NONE = '__none__'
export const TASK_PAGE_SIZE = 50
export const TASK_SEARCH_DEBOUNCE_MS = 300
