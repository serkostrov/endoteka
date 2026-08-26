import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'

export type DataTableSortDirection = 'asc' | 'desc'

export type DataTableColumn<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
  className?: string
  sortable?: boolean
}

type DataTableSort = {
  columnId: string
  direction: DataTableSortDirection
  onSort: (columnId: string) => void
}

type DataTablePagination = {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}

type DataTableProps<T> = {
  columns: DataTableColumn<T>[]
  data: T[]
  getRowId: (row: T) => string
  caption?: string
  isLoading?: boolean
  error?: string | null
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: T) => void
  pagination?: DataTablePagination
  sort?: DataTableSort
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  caption,
  isLoading = false,
  error,
  emptyTitle = 'Нет данных',
  emptyDescription = 'По выбранным условиям ничего не найдено.',
  onRowClick,
  pagination,
  sort,
}: DataTableProps<T>) {
  if (error) {
    return <ErrorState description={error} />
  }

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-3" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className="py-12" />
  }

  return (
    <div className="space-y-3">
      <Table>
        {caption ? <TableCaption className="sr-only">{caption}</TableCaption> : null}
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.sortable && sort ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-8 gap-1 px-2 font-medium"
                    onClick={() => sort.onSort(column.id)}
                  >
                    {column.header}
                    <SortIcon
                      active={sort.columnId === column.id}
                      direction={sort.columnId === column.id ? sort.direction : 'asc'}
                    />
                  </Button>
                ) : (
                  column.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => {
            const clickable = Boolean(onRowClick)

            return (
              <TableRow
                key={getRowId(row)}
                className={cn(clickable && 'cursor-pointer')}
                onClick={clickable ? () => onRowClick?.(row) : undefined}
                onKeyDown={
                  clickable
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onRowClick?.(row)
                        }
                      }
                    : undefined
                }
                tabIndex={clickable ? 0 : undefined}
              >
                {columns.map((column) => (
                  <TableCell key={column.id} className={column.className}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {pagination && pagination.pageCount > 1 ? (
        <Pagination className="justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault()
                  pagination.onPageChange(Math.max(1, pagination.page - 1))
                }}
                aria-disabled={pagination.page <= 1}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-3 text-sm text-muted-foreground">
                {pagination.page} из {pagination.pageCount}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(event) => {
                  event.preventDefault()
                  pagination.onPageChange(Math.min(pagination.pageCount, pagination.page + 1))
                }}
                aria-disabled={pagination.page >= pagination.pageCount}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  )
}

function SortIcon({ active, direction }: { active: boolean; direction: DataTableSortDirection }) {
  if (!active) {
    return <ArrowUpDown className="size-3.5 text-muted-foreground" />
  }

  return direction === 'asc' ? (
    <ArrowUp className="size-3.5" />
  ) : (
    <ArrowDown className="size-3.5" />
  )
}
