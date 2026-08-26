import { type DragEvent, type ReactNode, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DatePicker } from '@/components/shared/DatePicker'
import { Label } from '@/components/ui/label'
import { useWarrantyDefaults } from '@/features/devices/hooks/use-devices'
import { orderBoardColumns } from '@/lib/constants/orders'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { OrderDeadlineHint } from './OrderBadges'
import { OrderStatusMenu } from './OrderStatusActions'
import { useMoveOrderStatus, useOrderStatusCatalog } from '../hooks/use-orders'
import { groupStatusCatalog, hexToRgba, isClosedStatusGroup, type OrderStatusCatalogItem } from '../lib/status-catalog'
import type { OrderListItem } from '../services/orders-service'

const ORDER_DRAG_TYPE = 'application/x-endoteka-order'

type BoardColumn = {
  id: string
  label: string
  color: string
  statuses: OrderStatusCatalogItem[]
}

type OrderKanbanBoardProps = {
  orders: OrderListItem[]
  showClosed?: boolean
  onOpenOrder: (orderId: string) => void
}

type PendingMove = {
  order: OrderListItem
  status: OrderStatusCatalogItem
}

export function OrderKanbanBoard({ orders, showClosed = false, onOpenOrder }: OrderKanbanBoardProps) {
  const catalogQuery = useOrderStatusCatalog()
  const columns = useMemo(() => {
    const all = boardColumnsFromCatalog(catalogQuery.data)
    if (showClosed) {
      return all
    }
    return all.filter((column) => !isClosedStatusGroup(column.statuses))
  }, [catalogQuery.data, showClosed])
  const grouped = groupOrders(orders, columns)
  const moveStatus = useMoveOrderStatus()
  const [dragOrderId, setDragOrderId] = useState<string | null>(null)
  const [overColumnId, setOverColumnId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingMove | null>(null)
  const [warrantyDraft, setWarrantyDraft] = useState<{ start: string; end: string } | null>(null)
  const isIssue = Boolean(pending?.status.requiresWarranty)
  const isDestructive = Boolean(pending?.status.isDestructive)
  const defaultsQuery = useWarrantyDefaults(Boolean(pending) && Boolean(isIssue))
  const warrantyStart = warrantyDraft?.start ?? defaultsQuery.data?.startsOn ?? ''
  const warrantyEnd = warrantyDraft?.end ?? defaultsQuery.data?.endsOn ?? ''

  async function applyStatus(
    order: OrderListItem,
    status: OrderStatusCatalogItem,
    warranty?: { start: string; end: string } | null,
  ) {
    try {
      await moveStatus.mutateAsync({
        orderId: order.id,
        statusId: status.id,
        warranty: status.requiresWarranty ? warranty ?? null : null,
      })
      toast.success(`Статус: ${status.name}`)
      setPending(null)
      setWarrantyDraft(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function dropOnColumn(columnId: string, orderId: string) {
    const order = orders.find((item) => item.id === orderId)
    if (!order) {
      return
    }

    const column = columns.find((item) => item.id === columnId)
    if (!column) {
      return
    }

    if (column.statuses.some((item) => item.code === order.statusCode || item.id === order.statusId)) {
      return
    }

    const target = column.statuses[0]
    if (!target) {
      toast.error(`Нельзя перенести заказ в колонку «${column.label}».`)
      return
    }

    if (target.requiresWarranty || target.isDestructive) {
      setWarrantyDraft(null)
      setPending({ order, status: target })
      return
    }

    await applyStatus(order, target)
  }

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-112 w-full gap-3 overflow-x-auto pb-1">
      {columns.map((column) => {
        const items = grouped[column.id] ?? []
        const isOver = overColumnId === column.id && dragOrderId !== null
        const tint = hexToRgba(column.color, 0.08)

        return (
          <section
            key={column.id}
            className={cn(
              'flex h-full min-w-56 flex-1 flex-col overflow-hidden rounded-xl border',
              isOver && 'ring-2 ring-primary/40',
            )}
            style={{ backgroundColor: tint, borderColor: hexToRgba(column.color, 0.28) }}
            onDragOver={(event) => {
              if (!hasOrderDrag(event)) {
                return
              }
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setOverColumnId(column.id)
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                return
              }
              setOverColumnId((current) => (current === column.id ? null : current))
            }}
            onDrop={(event) => {
              event.preventDefault()
              setOverColumnId(null)
              const droppedId = readOrderDrag(event)
              setDragOrderId(null)
              if (droppedId) {
                void dropOnColumn(column.id, droppedId)
              }
            }}
          >
            <header className="flex items-center justify-between gap-2 px-3 py-2.5">
              <h2 className="text-sm font-semibold">{column.label}</h2>
              <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {items.length}
              </span>
            </header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {items.length === 0 ? (
                <p className="px-1 py-8 text-center text-xs text-muted-foreground">Нет заказов</p>
              ) : (
                items.map((order) => (
                  <OrderKanbanCard
                    key={order.id}
                    order={order}
                    accentColor={column.color}
                    dragging={dragOrderId === order.id}
                    onOpen={() => onOpenOrder(order.id)}
                    onDragStart={() => setDragOrderId(order.id)}
                    onDragEnd={() => {
                      setDragOrderId(null)
                      setOverColumnId(null)
                    }}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}

      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null)
            setWarrantyDraft(null)
          }
        }}
        title={isDestructive ? 'Отказ' : isIssue ? 'Выдача и гарантия' : 'Сменить статус'}
        description={
          pending
            ? isIssue
              ? `Заказ будет переведён в статус «${pending.status.name}». Срок гарантии сохраняется на сервере.`
              : `Заказ будет переведён в статус «${pending.status.name}». Действие запишется в журнал.`
            : ''
        }
        confirmLabel={isDestructive ? 'Подтвердить отказ' : isIssue ? 'Выдать' : 'Сменить статус'}
        confirmVariant={isDestructive ? 'destructive' : 'default'}
        isPending={moveStatus.isPending}
        onConfirm={() => {
          if (!pending) {
            return
          }
          if (isIssue && (!warrantyStart || !warrantyEnd)) {
            toast.error('Укажите срок гарантии.')
            return
          }
          void applyStatus(
            pending.order,
            pending.status,
            isIssue ? { start: warrantyStart, end: warrantyEnd } : null,
          )
        }}
      >
        {isIssue ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="board-warranty-start">Начало гарантии</Label>
              <DatePicker
                id="board-warranty-start"
                value={warrantyStart}
                allowClear={false}
                onChange={(next) => setWarrantyDraft({ start: next, end: warrantyEnd })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="board-warranty-end">Окончание гарантии</Label>
              <DatePicker
                id="board-warranty-end"
                value={warrantyEnd}
                allowClear={false}
                onChange={(next) => setWarrantyDraft({ start: warrantyStart, end: next })}
              />
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}

function OrderKanbanCard({
  order,
  accentColor,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  order: OrderListItem
  accentColor: string
  dragging: boolean
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const suppressClick = useRef(false)

  return (
    <article
      draggable
      className={cn(
        'cursor-grab rounded-lg border border-border bg-card p-3 shadow-xs active:cursor-grabbing',
        'border-l-[3px]',
        dragging && 'opacity-50',
      )}
      style={{ borderLeftColor: accentColor }}
      onDragStart={(event) => {
        suppressClick.current = true
        event.dataTransfer.setData(ORDER_DRAG_TYPE, order.id)
        event.dataTransfer.setData('text/plain', order.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        onOpen()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-primary">Заказ {order.number}</p>
        </div>
        <OrderDeadlineHint order={order} />
      </div>

      <dl className="mt-3 space-y-1.5">
        <CardField label="Статус">
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <OrderStatusMenu
              orderId={order.id}
              statusCode={order.statusCode}
              statusName={order.statusName}
              compact
            />
          </div>
        </CardField>
        <CardField label="Клиент">{order.customerName}</CardField>
        <CardField label="Прибор">{order.deviceLabel}</CardField>
        <CardField label="Серийный номер">{order.serialNumber}</CardField>
        <CardField label="Ответственный">{order.responsibleName || 'Не назначен'}</CardField>
      </dl>
    </article>
  )
}

function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium wrap-break-word">{children}</dd>
    </div>
  )
}

function boardColumnsFromCatalog(items: OrderStatusCatalogItem[] | undefined): BoardColumn[] {
  const active = (items ?? []).filter((item) => item.isActive)
  const groups = groupStatusCatalog(active)
  if (groups.length === 0) {
    return orderBoardColumns.map((column) => ({
      id: column.id,
      label: column.label,
      color: '#64748b',
      statuses: [],
    }))
  }

  return groups.map((group) => ({
    id: group.id,
    label: group.name,
    color: group.color,
    statuses: group.statuses,
  }))
}

function groupOrders(orders: OrderListItem[], columns: BoardColumn[]) {
  const grouped = Object.fromEntries(columns.map((column) => [column.id, [] as OrderListItem[]])) as Record<
    string,
    OrderListItem[]
  >
  const fallbackId = columns[0]?.id

  for (const order of orders) {
    const column = columns.find((item) =>
      item.statuses.some((status) => status.code === order.statusCode || status.id === order.statusId),
    )
    const target = column?.id ?? fallbackId
    if (target) {
      const bucket = grouped[target]
      if (bucket) {
        bucket.push(order)
      }
    }
  }

  return grouped
}

function hasOrderDrag(event: DragEvent) {
  return event.dataTransfer.types.includes(ORDER_DRAG_TYPE) || event.dataTransfer.types.includes('text/plain')
}

function readOrderDrag(event: DragEvent) {
  return event.dataTransfer.getData(ORDER_DRAG_TYPE) || event.dataTransfer.getData('text/plain')
}
