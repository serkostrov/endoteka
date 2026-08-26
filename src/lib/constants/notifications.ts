export const NotificationEvent = {
  ResponsibleAssigned: 'responsible_assigned',
  TaskAssigned: 'task_assigned',
  OrderStatusChanged: 'order_status_changed',
  DeadlineApproaching: 'deadline_approaching',
  DeadlineOverdue: 'deadline_overdue',
  OrderInRepair: 'order_in_repair',
} as const

export type NotificationEvent = (typeof NotificationEvent)[keyof typeof NotificationEvent]

export const notificationEventLabels: Record<string, string> = {
  responsible_assigned: 'Назначение ответственного',
  task_assigned: 'Назначение задачи',
  order_status_changed: 'Смена статуса заказа',
  deadline_approaching: 'Приближается срок',
  deadline_overdue: 'Срок просрочен',
  order_in_repair: 'Заказ в ремонте',
}

export const NotificationTarget = {
  Role: 'role',
  Responsible: 'responsible',
  Assignee: 'assignee',
} as const

export type NotificationTarget = (typeof NotificationTarget)[keyof typeof NotificationTarget]

export const notificationTargetLabels: Record<NotificationTarget, string> = {
  role: 'Роль',
  responsible: 'Ответственный заказа',
  assignee: 'Исполнитель задачи',
}

export const NotificationChannel = {
  InApp: 'in_app',
  Email: 'email',
  Telegram: 'telegram',
} as const

export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel]

export const notificationChannelLabels: Record<NotificationChannel, string> = {
  in_app: 'В приложении',
  email: 'Email',
  telegram: 'Telegram',
}

export const NotificationDeliveryStatus = {
  Pending: 'pending',
  Sent: 'sent',
  Failed: 'failed',
} as const
