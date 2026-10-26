import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { differenceInCalendarDays, differenceInHours } from 'date-fns'

import { StatusBadge } from '@/components/shared/StatusBadge'
import { DeadlineState, deadlineStateLabels } from '@/lib/constants/orders'
import { formatDate, toDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { useOrderStatusCatalog } from '../hooks/use-orders'
import {
  findStatusCatalogItem,
  hidesOrderDeadline,
  statusCatalogBadgeStyle,
  statusCodesHidingDeadline,
} from '../lib/status-catalog'
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

export function OrderStatusBadge({
  code,
  name,
  className,
}: {
  code?: string
  name: string
  className?: string
}) {
  const catalog = useOrderStatusCatalog()
  const item = findStatusCatalogItem(catalog.data ?? [], { code, name })
  return (
    <StatusBadge
      tone={orderStatusTone(item?.code ?? code ?? '')}
      style={statusCatalogBadgeStyle(item)}
      className={className}
    >
      {name}
    </StatusBadge>
  )
}

/** Смена статуса в ленте событий: цветные бейджи как в меню «Сменить статус». */
export function JournalStatusChangeBody({
  event,
}: {
  event: Pick<OrderJournalEventLike, 'summary' | 'payload'>
}) {
  const { fromName, toName, fromCode, toCode } = parseStatusChangeLabels(event)
  if (!fromName && !toName) {
    return <p>{event.summary}</p>
  }

  return (
    <p className="flex flex-wrap items-center gap-1.5">
      {fromName ? <OrderStatusBadge code={fromCode ?? undefined} name={fromName} /> : null}
      {fromName && toName ? (
        <span className="text-muted-foreground" aria-hidden="true">
          →
        </span>
      ) : null}
      {toName ? <OrderStatusBadge code={toCode ?? undefined} name={toName} /> : null}
    </p>
  )
}

type OrderJournalEventLike = {
  summary: string
  payload: unknown
}

function parseStatusChangeLabels(event: OrderJournalEventLike) {
  const payload =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : null
  const fromName = asNonEmptyString(payload?.from_name)
  const toName = asNonEmptyString(payload?.to_name)
  const fromCode = asNonEmptyString(payload?.from_code)
  const toCode = asNonEmptyString(payload?.to_code)

  if (fromName || toName) {
    return { fromName, toName, fromCode, toCode }
  }

  const parts = event.summary.split(/\s*(?:→|->)\s*/)
  if (parts.length >= 2) {
    return {
      fromName: parts[0]?.trim() || null,
      toName: parts.slice(1).join(' → ').trim() || null,
      fromCode: null,
      toCode: null,
    }
  }

  return {
    fromName: null,
    toName: event.summary.trim() || null,
    fromCode: null,
    toCode: null,
  }
}

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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

export function useOrderDeadlineHidden(statusCode: string | undefined) {
  const catalog = useOrderStatusCatalog()
  return useMemo(() => {
    if (!statusCode) {
      return false
    }
    const groupCode = catalog.data?.find((item) => item.code === statusCode)?.groupCode
    return hidesOrderDeadline(groupCode)
  }, [catalog.data, statusCode])
}

export function useStatusCodesHidingDeadline() {
  const catalog = useOrderStatusCatalog()
  return useMemo(() => statusCodesHidingDeadline(catalog.data ?? []), [catalog.data])
}

export function OrderDeadlineHint({
  order,
  className,
}: {
  order: Pick<OrderListItem, 'deadline' | 'deadlineState' | 'statusCode'>
  className?: string
}) {
  const hidden = useOrderDeadlineHidden(order.statusCode)
  if (
    hidden ||
    !order.deadline ||
    order.deadlineState === DeadlineState.None ||
    order.deadlineState === DeadlineState.Closed
  ) {
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

export function OrderDeadlineCell({
  order,
}: {
  order: Pick<OrderListItem, 'deadline' | 'deadlineState' | 'statusCode'>
}) {
  const hidden = useOrderDeadlineHidden(order.statusCode)
  if (
    hidden ||
    !order.deadline ||
    order.deadlineState === DeadlineState.None ||
    order.deadlineState === DeadlineState.Closed
  ) {
    return <span className="text-muted-foreground">—</span>
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
