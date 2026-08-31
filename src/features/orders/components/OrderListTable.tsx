import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { deviceSerialLine } from '@/features/devices/classification'
import { DeadlineState } from '@/lib/constants/orders'
import { formatDate, formatDateTime } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { OrderDeadlineHint } from './OrderBadges'
import { OrderStatusMenu } from './OrderStatusActions'
import type { OrderListItem, OrderSortColumn } from '../services/orders-service'

const cellClass = 'min-w-0 px-3 py-2.5 align-middle whitespace-normal'

const COLUMNS: { id: OrderSortColumn; label: string; className: string }[] = [
  { id: 'number', label: 'Заказ', className: 'w-36' },
  { id: 'deadline', label: 'Крайний срок', className: 'w-36' },
  { id: 'status', label: 'Статус', className: 'w-40' },
  { id: 'responsible', label: 'Ответственный', className: 'hidden w-36 md:table-cell' },
  { id: 'device', label: 'Изделие', className: '' },
  { id: 'malfunction', label: 'Неисправность', className: 'hidden w-44 lg:table-cell' },
  { id: 'client', label: 'Клиент', className: 'w-52' },
]

type OrderListTableProps = {
  data: OrderListItem[]
  total: number
  page: number
  pageSize: number
  sort: OrderSortColumn
  direction: 'asc' | 'desc'
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void
  onPageChange: (page: number) => void
  onSort: (column: OrderSortColumn) => void
  onOpenOrder: (orderId: string) => void
}

export function OrderListTable({
  data,
  total,
  page,
  pageSize,
  sort,
  direction,
  isLoading = false,
  error,
  onRetry,
  onPageChange,
  onSort,
  onOpenOrder,
}: OrderListTableProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  if (error) {
    return <ErrorState description={error} onRetry={onRetry} />
  }

  if (isLoading) {
    return (
      <div className="space-y-2 overflow-hidden rounded-xl border bg-card p-3" aria-busy="true">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title="Заказы не найдены"
        description="Измените поиск или фильтр, чтобы увидеть заказы."
        className="py-12"
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table className="min-w-5xl table-fixed">
          <TableCaption className="sr-only">Список заказов</TableCaption>
          <TableHeader>
            <TableRow className="border-b bg-muted/50 hover:bg-muted/50">
              {COLUMNS.map((column, index) => (
                <SortableHead
                  key={column.id}
                  column={column.id}
                  label={column.label}
                  className={column.className}
                  buttonClassName={cn(index === 0 && 'pl-4', index === COLUMNS.length - 1 && 'pr-4')}
                  sort={sort}
                  direction={direction}
                  onSort={onSort}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((order, index) => {
              const deadline = deadlineLines(order)

              return (
                <TableRow
                  key={order.id}
                  className={cn('cursor-pointer', index % 2 === 1 && 'bg-muted/25')}
                  onClick={() => onOpenOrder(order.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpenOrder(order.id)
                    }
                  }}
                  tabIndex={0}
                >
                  <TableCell className={cn(cellClass, 'pl-4')}>
                    <TwoLine
                      primary={<span className="font-semibold text-primary">{order.number}</span>}
                      secondary={formatDateTime(order.createdAt)}
                    />
                  </TableCell>
                  <TableCell className={cellClass}>
                    <TwoLine primary={deadline.primary} secondary={deadline.secondary} />
                  </TableCell>
                  <TableCell className={cellClass}>
                    <div
                      className="-ml-1.5 flex items-center"
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
                  </TableCell>
                  <TableCell className={cn(cellClass, 'hidden md:table-cell')}>
                    <span className="block truncate">{order.responsibleName || 'Не назначен'}</span>
                  </TableCell>
                  <TableCell className={cellClass}>
                    <TwoLine
                      primary={order.deviceLabel || '—'}
                      secondary={deviceSerialLine(order.serialNumber) || undefined}
                    />
                  </TableCell>
                  <TableCell className={cn(cellClass, 'hidden lg:table-cell')}>
                    <span className="block truncate text-muted-foreground">
                      {order.claimedMalfunction || '—'}
                    </span>
                  </TableCell>
                  <TableCell className={cn(cellClass, 'pr-4')}>
                    <span className="block truncate font-medium text-primary">{order.customerName}</span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Всего — {total.toLocaleString('ru-RU')}</p>
        {pageCount > 1 ? (
          <Pagination className="mx-0 w-auto justify-start sm:justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    onPageChange(Math.max(1, page - 1))
                  }}
                  aria-disabled={page <= 1}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="px-3 text-sm text-muted-foreground">
                  {page} из {pageCount}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    onPageChange(Math.min(pageCount, page + 1))
                  }}
                  aria-disabled={page >= pageCount}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
      </div>
    </div>
  )
}

function SortableHead({
  column,
  label,
  className,
  buttonClassName,
  sort,
  direction,
  onSort,
}: {
  column: OrderSortColumn
  label: string
  className?: string
  buttonClassName?: string
  sort: OrderSortColumn
  direction: 'asc' | 'desc'
  onSort: (column: OrderSortColumn) => void
}) {
  const active = sort === column

  return (
    <TableHead
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(
        'h-9 p-0 text-xs font-medium text-muted-foreground',
        'border-r border-border/70 last:border-r-0',
        active && 'bg-muted text-foreground',
        className,
      )}
    >
      <button
        type="button"
        aria-label={`Сортировать по колонке ${label}`}
        className={cn(
          'flex h-9 w-full items-center gap-1 px-3 text-left hover:bg-muted/70',
          buttonClassName,
        )}
        onClick={() => onSort(column)}
      >
        <span className="min-w-0 truncate">{label}</span>
        {active ? (
          direction === 'asc' ? (
            <ArrowUp className="size-3.5 shrink-0" />
          ) : (
            <ArrowDown className="size-3.5 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 shrink-0 text-muted-foreground/80" />
        )}
      </button>
    </TableHead>
  )
}

function TwoLine({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-0.5">
      <div className="truncate leading-5">{primary}</div>
      {secondary ? (
        <div className="truncate text-xs leading-4 text-muted-foreground tabular-nums">{secondary}</div>
      ) : null}
    </div>
  )
}

function deadlineLines(order: OrderListItem) {
  if (!order.deadline) {
    return { primary: <span className="text-muted-foreground">—</span>, secondary: undefined }
  }

  if (order.deadlineState === DeadlineState.None || order.deadlineState === DeadlineState.Closed) {
    return { primary: formatDate(order.deadline), secondary: undefined }
  }

  return {
    primary: <OrderDeadlineHint order={order} />,
    secondary: formatDateTime(order.deadline),
  }
}
