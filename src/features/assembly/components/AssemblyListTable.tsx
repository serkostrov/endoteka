import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ListPagination } from '@/components/shared/ListPagination'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { deviceSerialLine } from '@/features/devices/classification'
import { formatDateTime } from '@/lib/utils/date'
import { formatInteger } from '@/lib/utils/number'
import { cn } from '@/lib/utils'

import type { AssemblyListItem } from '../services/assembly-service'
import { AssemblyCompletenessBadge } from './AssemblyCompletenessBadge'

const cellClass = 'min-w-0 px-3 py-2.5 align-middle whitespace-normal'

type AssemblyListTableProps = {
  data: AssemblyListItem[]
  total: number
  page: number
  pageSize: number
  tab?: 'active' | 'done'
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  onOpenAssembly: (orderId: string) => void
}

export function AssemblyListTable({
  data,
  total,
  page,
  pageSize,
  tab = 'active',
  isLoading = false,
  error,
  onRetry,
  onPageChange,
  onPageSizeChange,
  onOpenAssembly,
}: AssemblyListTableProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  if (error) {
    return <ErrorState description={error} onRetry={onRetry} />
  }

  if (isLoading) {
    return (
      <div className="space-y-2 overflow-hidden rounded-xl border bg-card p-3" aria-busy="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title={tab === 'done' ? 'Нет выполненных сборок' : 'Нет заказов в сборке'}
        description={
          tab === 'done'
            ? 'Сюда попадут заказы с комплектностью 100%.'
            : 'Заказы со статусом «В ремонт» появятся здесь, пока комплектность меньше 100%.'
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Заказ</TableHead>
              <TableHead>Изделие</TableHead>
              <TableHead className="w-64">Клиент</TableHead>
              <TableHead className="w-32">Комплектность</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => {
              const serial = deviceSerialLine(item.serialNumber)
              return (
                <TableRow
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => onOpenAssembly(item.id)}
                >
                  <TableCell className={cn(cellClass, 'w-36')}>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{item.number}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDateTime(item.createdAt)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className={cellClass}>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{item.deviceLabel || '—'}</p>
                      {serial ? (
                        <p className="truncate text-xs text-muted-foreground">{serial}</p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className={cn(cellClass, 'w-64')}>
                    <p className="truncate">{item.customerName || '—'}</p>
                  </TableCell>
                  <TableCell className={cn(cellClass, 'w-32')}>
                    <AssemblyCompletenessBadge pct={item.completenessPct} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Всего — {formatInteger(total)}</p>
        <ListPagination
          page={page}
          pageCount={pageCount}
          onPageChange={onPageChange}
          pageSize={pageSize}
          onPageSizeChange={onPageSizeChange}
          className="justify-end sm:ml-auto"
        />
      </div>
    </div>
  )
}
