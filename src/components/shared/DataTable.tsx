import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ListPagination } from '@/components/shared/ListPagination'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  pageSize?: number
  onPageSizeChange?: (size: number) => void
}

type DataTableSelection = {
  selectedIds: string[]
  onSelectedIdsChange: (ids: string[]) => void
}

type DataTableProps<T> = {
  columns: DataTableColumn<T>[]
  data: T[]
  getRowId: (row: T) => string
  caption?: string
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: T) => void
  pagination?: DataTablePagination
  sort?: DataTableSort
  selection?: DataTableSelection
  /** Tighter row padding for dense lists. */
  dense?: boolean
  /** Draw a border around the table (default when dense/scrollable). */
  framed?: boolean
  rowClassName?: (row: T) => string | undefined
  /** Approx. visible body rows before vertical scroll (header stays sticky). */
  maxVisibleRows?: number
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  caption,
  isLoading = false,
  error,
  onRetry,
  emptyTitle = 'Нет данных',
  emptyDescription = 'По выбранным условиям ничего не найдено.',
  onRowClick,
  pagination,
  sort,
  selection,
  dense = false,
  framed,
  rowClassName,
  maxVisibleRows,
}: DataTableProps<T>) {
  if (error) {
    return <ErrorState description={error} onRetry={onRetry} />
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

  const canChangePageSize = Boolean(pagination?.pageSize != null && pagination.onPageSizeChange)
  const showPagination = Boolean(pagination) && (pagination!.pageCount > 1 || canChangePageSize)
  const headClass = dense ? 'h-8 px-2 text-xs' : undefined
  const cellClass = dense ? 'px-2 py-1.5 text-sm' : undefined
  const scrollable = typeof maxVisibleRows === 'number' && maxVisibleRows > 0
  const showFrame = framed ?? (dense || scrollable)
  const rowHeightRem = dense ? 2.25 : 2.75
  const headHeightRem = dense ? 2 : 2.5
  const scrollMaxHeight = scrollable
    ? `${headHeightRem + maxVisibleRows * rowHeightRem}rem`
    : undefined

  const pageIds = data.map((row) => getRowId(row))
  const selectedIds = selection?.selectedIds ?? []
  const selectedOnPage = pageIds.filter((id) => selectedIds.includes(id))
  const allPageSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length
  const somePageSelected = selectedOnPage.length > 0 && !allPageSelected

  function toggleAllPage(checked: boolean) {
    if (!selection) {
      return
    }
    if (checked) {
      selection.onSelectedIdsChange([...new Set([...selectedIds, ...pageIds])])
      return
    }
    const pageSet = new Set(pageIds)
    selection.onSelectedIdsChange(selectedIds.filter((id) => !pageSet.has(id)))
  }

  function toggleOne(rowId: string, checked: boolean) {
    if (!selection) {
      return
    }
    if (checked) {
      selection.onSelectedIdsChange(selectedIds.includes(rowId) ? selectedIds : [...selectedIds, rowId])
      return
    }
    selection.onSelectedIdsChange(selectedIds.filter((id) => id !== rowId))
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          showFrame && 'rounded-md border',
          scrollable && 'overflow-auto',
        )}
        style={scrollMaxHeight ? { maxHeight: scrollMaxHeight } : undefined}
      >
        <Table containerClassName={scrollable ? 'overflow-visible' : undefined}>
          {caption ? <TableCaption className="sr-only">{caption}</TableCaption> : null}
          <TableHeader
            className={cn(
              !scrollable && 'bg-muted/60',
              scrollable &&
                'sticky top-0 z-10 bg-muted/95 shadow-[inset_0_-1px_0_0_var(--border)] backdrop-blur-sm [&_tr]:border-b-0',
            )}
          >
            <TableRow
              className={cn(
                'hover:bg-transparent',
                !scrollable && 'bg-muted/60',
                scrollable && 'bg-muted/95',
              )}
            >
              {selection ? (
                <TableHead className={cn(headClass, 'w-10 px-2 text-center')}>
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                    onCheckedChange={(value) => toggleAllPage(value === true)}
                    aria-label="Выбрать все на странице"
                  />
                </TableHead>
              ) : null}
              {columns.map((column) => (
                <TableHead key={column.id} className={cn(headClass, column.className)}>
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
              const rowId = getRowId(row)
              const clickable = Boolean(onRowClick)
              const selected = selectedIds.includes(rowId)

              return (
                <TableRow
                  key={rowId}
                  data-state={selected ? 'selected' : undefined}
                  className={cn(
                    clickable && 'cursor-pointer',
                    selected && 'bg-primary/5',
                    rowClassName?.(row),
                  )}
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
                  {selection ? (
                    <TableCell
                      className={cn(cellClass, 'w-10 px-2 text-center')}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(value) => toggleOne(rowId, value === true)}
                        aria-label="Выбрать строку"
                      />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell key={column.id} className={cn(cellClass, column.className)}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {showPagination && canChangePageSize ? (
        <ListPagination
          page={pagination!.page}
          pageCount={pagination!.pageCount}
          onPageChange={pagination!.onPageChange}
          pageSize={pagination!.pageSize!}
          onPageSizeChange={pagination!.onPageSizeChange!}
        />
      ) : showPagination ? (
        <ListPagination
          page={pagination!.page}
          pageCount={pagination!.pageCount}
          onPageChange={pagination!.onPageChange}
          pageSize={PAGE_SIZE_FALLBACK}
          onPageSizeChange={() => undefined}
          hidePageSize
        />
      ) : null}
    </div>
  )
}

const PAGE_SIZE_FALLBACK = 20

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
