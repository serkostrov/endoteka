export const OrderStatusCode = {
  Received: 'received',
  Diagnostics: 'diagnostics',
  WaitingApproval: 'waiting_approval',
  WaitingParts: 'waiting_parts',
  Repair: 'repair',
  QualityCheck: 'quality_check',
  Ready: 'ready',
  Issued: 'issued',
  Cancelled: 'cancelled',
} as const

export type OrderStatusCode = (typeof OrderStatusCode)[keyof typeof OrderStatusCode]

export const DeadlineState = {
  Closed: 'closed',
  None: 'none',
  Overdue: 'overdue',
  Approaching: 'approaching',
  Normal: 'normal',
} as const

export type DeadlineState = (typeof DeadlineState)[keyof typeof DeadlineState]

export const TransitionRuleCode = {
  DiagnosticsConclusion: 'diagnostics_conclusion',
  ResponsibleAssigned: 'responsible_assigned',
} as const

export type TransitionRuleCode = (typeof TransitionRuleCode)[keyof typeof TransitionRuleCode]

export const ORDER_ATTACHMENTS_BUCKET = 'order-attachments'
export const ORDER_PAGE_SIZE = 20
export const ORDER_BOARD_PAGE_SIZE = 500
export const ORDER_SEARCH_DEBOUNCE_MS = 300

export const OrderBoardColumn = {
  New: 'new',
  Progress: 'progress',
  Waiting: 'waiting',
  Ready: 'ready',
  Done: 'done',
} as const

export type OrderBoardColumnId = (typeof OrderBoardColumn)[keyof typeof OrderBoardColumn]

export const orderBoardColumns: {
  id: OrderBoardColumnId
  label: string
  statusCodes: string[]
}[] = [
  { id: OrderBoardColumn.New, label: 'Новое', statusCodes: [OrderStatusCode.Received] },
  {
    id: OrderBoardColumn.Progress,
    label: 'В процессе',
    statusCodes: [OrderStatusCode.Diagnostics, OrderStatusCode.Repair, OrderStatusCode.QualityCheck],
  },
  {
    id: OrderBoardColumn.Waiting,
    label: 'Ожидает',
    statusCodes: [OrderStatusCode.WaitingApproval, OrderStatusCode.WaitingParts],
  },
  { id: OrderBoardColumn.Ready, label: 'К выдаче', statusCodes: [OrderStatusCode.Ready] },
  {
    id: OrderBoardColumn.Done,
    label: 'Готово',
    statusCodes: [OrderStatusCode.Issued, OrderStatusCode.Cancelled],
  },
]

export function getOrderBoardColumnId(statusCode: string): OrderBoardColumnId {
  const match = orderBoardColumns.find((column) => column.statusCodes.includes(statusCode))
  return match?.id ?? OrderBoardColumn.Progress
}

export const ORDER_FILE_MAX_BYTES = 5 * 1024 * 1024 * 1024
export const ORDER_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'
export const ORDER_FILE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf']
export const ORDER_JOURNAL_NOTE_MAX_LENGTH = 4000
export const ORDER_JOURNAL_MAX_FILES = 10

export const OrderJournalEventType = {
  Comment: 'comment',
  Attachment: 'attachment',
} as const

export type OrderJournalEventType = (typeof OrderJournalEventType)[keyof typeof OrderJournalEventType]

export const deadlineStateLabels: Record<DeadlineState, string> = {
  closed: 'Закрыт',
  none: 'Без срока',
  overdue: 'Просрочен',
  approaching: 'Ближний срок',
  normal: 'В срок',
}

export function isDeadlineState(value: string): value is DeadlineState {
  return Object.values(DeadlineState).includes(value as DeadlineState)
}

export function isTerminalStatusCode(code: string) {
  return code === OrderStatusCode.Issued || code === OrderStatusCode.Cancelled
}
