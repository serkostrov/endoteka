import { Clock } from 'lucide-react'
import { differenceInCalendarDays } from 'date-fns'

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

export function OrderDeadlineHint({ order }: { order: Pick<OrderListItem, 'deadline' | 'deadlineState'> }) {
  if (!order.deadline || order.deadlineState === DeadlineState.None || order.deadlineState === DeadlineState.Closed) {
    return null
  }

  const date = toDate(order.deadline)
  const days = date ? differenceInCalendarDays(date, startOfToday()) : 0
  const label =
    order.deadlineState === DeadlineState.Overdue
      ? `−${Math.abs(days)} дн.`
      : order.deadlineState === DeadlineState.Approaching
        ? `${days} дн.`
        : formatDate(order.deadline)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        order.deadlineState === DeadlineState.Overdue && 'text-destructive',
        order.deadlineState === DeadlineState.Approaching && 'text-warning',
        order.deadlineState === DeadlineState.Normal && 'text-muted-foreground',
      )}
    >
      <Clock className="size-3.5" aria-hidden="true" />
      {label}
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
