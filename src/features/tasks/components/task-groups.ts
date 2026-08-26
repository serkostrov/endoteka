import { isTaskDueToday, isTaskOverdue, type TaskListItem } from '../services/tasks-service'

export type TaskGroupId = 'overdue' | 'today' | 'upcoming' | 'none' | 'completed'

export const taskGroupLabels: Record<TaskGroupId, string> = {
  overdue: 'Просроченные',
  today: 'Сегодня',
  upcoming: 'Предстоящие',
  none: 'Без срока',
  completed: 'Выполненные',
}

const groupOrder: TaskGroupId[] = ['overdue', 'today', 'upcoming', 'none', 'completed']

export function groupTasks(tasks: TaskListItem[]) {
  const grouped: Record<TaskGroupId, TaskListItem[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    none: [],
    completed: [],
  }

  for (const task of tasks) {
    grouped[taskGroupId(task)].push(task)
  }

  return groupOrder
    .map((id) => ({ id, label: taskGroupLabels[id], items: grouped[id] }))
    .filter((group) => group.items.length > 0)
}

function taskGroupId(task: TaskListItem): TaskGroupId {
  if (task.completed) {
    return 'completed'
  }
  if (isTaskOverdue(task.dueDate, task.completed)) {
    return 'overdue'
  }
  if (isTaskDueToday(task.dueDate, task.completed)) {
    return 'today'
  }
  if (!task.dueDate) {
    return 'none'
  }
  return 'upcoming'
}
