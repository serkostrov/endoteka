import { Clock } from 'lucide-react'
import { differenceInCalendarDays, differenceInHours } from 'date-fns'

import { StatusBadge } from '@/components/shared/StatusBadge'
import { DeadlineState, deadlineStateLabels } from '@/lib/constants/orders'
import { formatDate, toDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { useOrderStatusCatalog } from '../hooks/use-orders'
import { statusBadgeStyle } from '../lib/status-catalog'
import type { OrderListItem } from '../services/orders-service'

export function orderStatusTone(code: string): 'neutral' | 'info' | 'warning' | 'danger' | 'success' {
  switch (code) {
    case 'ready':
    case 'issued':
      return 'success'
    case 'waiting_approval':
    case 'waiting_parts':
      return 'warning'
    case 'cancelled':
      return 'danger'
    case 'received':
    case 'diagnostics':
    case 'repair':
    case 'quality_check':
      return 'info'
    default:
      return 'neutral'
  }
}

function deadlineTone(state: DeadlineState): 'neutral' | 'warning' | 'danger' | undefined {
  if (state === DeadlineState.Overdue) {
    return 'danger'
  }
  if (state === DeadlineState.Approaching) {
    return 'warning'
  }
  return 'neutral'
}

export function OrderStatusBadge({ code, name }: { code: string; name: string }) {
  const catalog = useOrderStatusCatalog()
  const color = catalog.data?.find((item) => item.code === code)?.color
  return (
    <StatusBadge tone={orderStatusTone(code)} style={statusBadgeStyle(color)}>
      {name}
    </StatusBadge>
  )
}

function relativeDeadlineLabel(deadline: string, state: DeadlineState) {
  const date = toDate(deadline)
  if (!date) {
    return formatDate(deadline)
  }

  const hours = differenceInHours(date, new Date())
  const days = differenceInCalendarDays(date, startOfToday())

  if (state === DeadlineState.Overdue) {
    const absHours = Math.abs(hours)
    return absHours < 24 ? `−${Math.max(1, absHours)} ч.` : `−${Math.max(1, Math.abs(days))} дн.`
  }

  if (state === DeadlineState.Approaching) {
    return hours >= 0 && hours < 24 ? `${Math.max(1, hours)} ч.` : `${Math.max(1, days)} дн.`
  }

  return formatDate(deadline)
}

export function OrderDeadlineHint({
  order,
  className,
}: {
  order: Pick<OrderListItem, 'deadline' | 'deadlineState'>
  className?: string
}) {
  if (!order.deadline || order.deadlineState === DeadlineState.None || order.deadlineState === DeadlineState.Closed) {
    return null
  }

  return (
    <span
      title={`${formatDate(order.deadline)} · ${deadlineStateLabels[order.deadlineState]}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none',
        order.deadlineState === DeadlineState.Overdue && 'bg-destructive/12 text-destructive',
        order.deadlineState === DeadlineState.Approaching && 'bg-warning/12 text-warning',
        order.deadlineState === DeadlineState.Normal && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      <Clock className="size-3 shrink-0" aria-hidden="true" />
      {relativeDeadlineLabel(order.deadline, order.deadlineState)}
    </span>
  )
}

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function OrderDeadlineCell({ order }: { order: Pick<OrderListItem, 'deadline' | 'deadlineState'> }) {
  if (!order.deadline || order.deadlineState === DeadlineState.None) {
    return <span className="text-muted-foreground">—</span>
  }

  if (order.deadlineState === DeadlineState.Closed) {
    return <span>{formatDate(order.deadline)}</span>
  }

  const tone = deadlineTone(order.deadlineState)
  const label = `${formatDate(order.deadline)}${
    order.deadlineState === DeadlineState.Normal ? '' : ` · ${deadlineStateLabels[order.deadlineState]}`
  }`

  if (order.deadlineState === DeadlineState.Normal) {
    return <span>{formatDate(order.deadline)}</span>
  }

  return <StatusBadge tone={tone}>{label}</StatusBadge>
}
