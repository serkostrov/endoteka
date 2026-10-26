import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { ListPagination } from '@/components/shared/ListPagination'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { activeFilterControlClass } from '@/components/shared/active-filter-style'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import {
  formatMoney,
  formatQuantity,
  InventoryWriteOffStatus,
  inventoryWriteOffStatusLabels,
  inventoryWriteOffStatusTone,
  isInventoryWriteOffStatus,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { usePageSize } from '@/hooks/use-page-size'
import {
  nextListSortDir,
  parseListSortColumn,
  parseListSortDir,
} from '@/lib/list-table-sort'
import { formatDate, formatDateTime } from '@/lib/utils/date'

import { InventoryWriteOffSheet } from './InventoryWriteOffSheet'
import { WriteOffBulkActions } from './WriteOffBulkActions'
import { WriteOffDeleteControl } from './WriteOffDeleteControl'
import { WriteOffStockSheet } from './WriteOffStockSheet'
import { useInventoryWriteOffs } from '../hooks/use-inventory'
import type {
  InventoryWriteOffListItem,
  InventoryWriteOffSortColumn,
} from '../services/inventory-service'

const WRITE_OFF_SORT_COLUMNS = [
  'date',
  'status',
  'reason',
  'lines',
  'qty',
  'amount',
  'actor',
  'created',
] as const satisfies readonly InventoryWriteOffSortColumn[]

const DEFAULT_WRITE_OFF_SORT: InventoryWriteOffSortColumn = 'created'
const DEFAULT_WRITE_OFF_DIR = 'desc' as const

export function InventoryWriteOffsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [createOpen, setCreateOpen] = useState(false)
  const [editDraftId, setEditDraftId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const canWriteOff = useHasPermission(Permission.InventoryWriteOff)

  const statusParam = searchParams.get('status')
  const statusFilter =
    statusParam && isInventoryWriteOffStatus(statusParam) ? statusParam : 'all'
  const listSort = parseListSortColumn(
    searchParams.get('sort'),
    WRITE_OFF_SORT_COLUMNS,
    DEFAULT_WRITE_OFF_SORT,
  )
  const listDir = parseListSortDir(searchParams.get('dir'), DEFAULT_WRITE_OFF_DIR)

  const filterKey = `${statusFilter}|${listSort}|${listDir}`
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey)
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey)
    setPage(1)
    setSelectedIds([])
  }

  const listFilters = useMemo(
    () => ({
      status: statusFilter,
      sort: listSort,
      direction: listDir,
    }),
    [statusFilter, listSort, listDir],
  )

  const writeOffsQuery = useInventoryWriteOffs(page, pageSize, listFilters)
  const writeOffId = searchParams.get('writeOff')
  const total = writeOffsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function patchFilters(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    }
    setSearchParams(next, { replace: true })
  }

  function openWriteOff(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('writeOff', id)
    setSearchParams(next, { replace: true })
  }

  function closeWriteOff() {
    const next = new URLSearchParams(searchParams)
    next.delete('writeOff')
    setSearchParams(next, { replace: true })
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
    setSelectedIds([])
  }

  function handleSort(columnId: string) {
    const column = parseListSortColumn(columnId, WRITE_OFF_SORT_COLUMNS, DEFAULT_WRITE_OFF_SORT)
    const nextDir = nextListSortDir(listSort, column, listDir, DEFAULT_WRITE_OFF_DIR)
    const isDefault = column === DEFAULT_WRITE_OFF_SORT && nextDir === DEFAULT_WRITE_OFF_DIR
    patchFilters({
      sort: isDefault ? null : column,
      dir: isDefault ? null : nextDir,
    })
  }

  function handleRowClick(row: InventoryWriteOffListItem) {
    if (row.status === InventoryWriteOffStatus.Draft) {
      if (canWriteOff) {
        setEditDraftId(row.id)
      }
      return
    }
    openWriteOff(row.id)
  }

  useEffect(() => {
    if (!writeOffId || !canWriteOff || !writeOffsQuery.data) {
      return
    }
    const row = writeOffsQuery.data.items.find((item) => item.id === writeOffId)
    if (row?.status !== InventoryWriteOffStatus.Draft) {
      return
    }
    setEditDraftId(writeOffId)
    closeWriteOff()
  }, [writeOffId, canWriteOff, writeOffsQuery.data])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Списания"
        description="Документы списания товара со склада."
        actions={
          canWriteOff ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новое списание
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={statusFilter}
          onValueChange={(value) => patchFilters({ status: value === 'all' ? null : value })}
        >
          <SelectTrigger
            aria-label="Фильтр по статусу"
            className={activeFilterControlClass(statusFilter !== 'all', 'w-auto min-w-40')}
            onClear={
              statusFilter !== 'all' ? () => patchFilters({ status: null }) : undefined
            }
            clearLabel="Сбросить фильтр по статусу"
          >
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value={InventoryWriteOffStatus.Draft}>
              <StatusBadge tone={inventoryWriteOffStatusTone(InventoryWriteOffStatus.Draft)}>
                {inventoryWriteOffStatusLabels.draft}
              </StatusBadge>
            </SelectItem>
            <SelectItem value={InventoryWriteOffStatus.Posted}>
              <StatusBadge tone={inventoryWriteOffStatusTone(InventoryWriteOffStatus.Posted)}>
                {inventoryWriteOffStatusLabels.posted}
              </StatusBadge>
            </SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {selectedIds.length > 0 ? (
        <WriteOffBulkActions selectedIds={selectedIds} onClear={() => setSelectedIds([])} />
      ) : null}

      {(() => {
        const items = writeOffsQuery.data?.items ?? []
        const emptyDescription =
          statusFilter !== 'all'
            ? 'Нет списаний по выбранному фильтру.'
            : 'Оформите списание, чтобы уменьшить остаток на складе.'
        return (
          <>
            <div className="space-y-2 md:hidden">
              {writeOffsQuery.isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Загрузка…</p>
              ) : writeOffsQuery.error ? (
                <p className="text-sm text-destructive">{getErrorMessage(writeOffsQuery.error)}</p>
              ) : items.length === 0 ? (
                <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                  {emptyDescription}
                </p>
              ) : (
                items.map((row) => (
                  <article
                    key={row.id}
                    className="flex cursor-pointer flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 shadow-xs"
                    onClick={() => handleRowClick(row)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleRowClick(row)
                      }
                    }}
                    role="link"
                    tabIndex={0}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium tabular-nums">
                          {formatDate(row.writeOffDate)}
                        </p>
                        <p className="mt-0.5 truncate text-sm font-medium">{row.reason || '—'}</p>
                        {row.notes ? (
                          <p className="truncate text-xs text-muted-foreground">{row.notes}</p>
                        ) : null}
                      </div>
                      <StatusBadge tone={inventoryWriteOffStatusTone(row.status)}>
                        {inventoryWriteOffStatusLabels[row.status]}
                      </StatusBadge>
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {row.lineCount} стр. · {formatQuantity(row.totalQuantity)} ·{' '}
                      {formatMoney(row.totalAmount)}
                    </p>
                    {canWriteOff ? (
                      <div
                        className="flex justify-end"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <WriteOffDeleteControl
                          writeOff={{ id: row.id, reason: row.reason, status: row.status }}
                          onDeleted={() => {
                            setSelectedIds((ids) => ids.filter((id) => id !== row.id))
                            if (writeOffId === row.id) {
                              closeWriteOff()
                            }
                            if (editDraftId === row.id) {
                              setEditDraftId(null)
                            }
                          }}
                        />
                      </div>
                    ) : null}
                  </article>
                ))
              )}
              <ListPagination
                page={page}
                pageCount={pageCount}
                onPageChange={setPage}
                pageSize={pageSize}
                onPageSizeChange={handlePageSizeChange}
                className="justify-end"
              />
            </div>
            <div className="hidden md:block">
              <DataTable
                caption="Списания"
                isLoading={writeOffsQuery.isLoading}
                error={writeOffsQuery.error ? getErrorMessage(writeOffsQuery.error) : null}
                data={items}
                getRowId={(row) => row.id}
                emptyTitle="Списаний нет"
                emptyDescription={emptyDescription}
                onRowClick={handleRowClick}
                selection={{
                  selectedIds,
                  onSelectedIdsChange: setSelectedIds,
                }}
                pagination={{
                  page,
                  pageCount,
                  onPageChange: setPage,
                  pageSize,
                  onPageSizeChange: handlePageSizeChange,
                }}
                sort={{
                  columnId: listSort,
                  direction: listDir,
                  onSort: handleSort,
                }}
                columns={[
                  {
                    id: 'date',
                    header: 'Дата',
                    sortable: true,
                    cell: (row) => formatDate(row.writeOffDate),
                  },
                  {
                    id: 'status',
                    header: 'Статус',
                    sortable: true,
                    cell: (row) => (
                      <StatusBadge tone={inventoryWriteOffStatusTone(row.status)}>
                        {inventoryWriteOffStatusLabels[row.status]}
                      </StatusBadge>
                    ),
                  },
                  {
                    id: 'reason',
                    header: 'Причина',
                    sortable: true,
                    cell: (row) => (
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.reason || '—'}</p>
                        {row.notes ? (
                          <p className="truncate text-xs text-muted-foreground">{row.notes}</p>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    id: 'lines',
                    header: 'Строк',
                    sortable: true,
                    cell: (row) => String(row.lineCount),
                  },
                  {
                    id: 'qty',
                    header: 'Кол-во',
                    sortable: true,
                    cell: (row) => formatQuantity(row.totalQuantity),
                  },
                  {
                    id: 'amount',
                    header: 'Сумма',
                    sortable: true,
                    className: 'tabular-nums',
                    cell: (row) => formatMoney(row.totalAmount),
                  },
                  {
                    id: 'actor',
                    header: 'Кто',
                    sortable: true,
                    cell: (row) => row.actorName || '—',
                  },
                  {
                    id: 'created',
                    header: 'Создан',
                    sortable: true,
                    cell: (row) => formatDateTime(row.createdAt),
                  },
                  ...(canWriteOff
                    ? [
                        {
                          id: 'actions',
                          header: 'Действия',
                          className: 'w-[1%] whitespace-nowrap',
                          cell: (row: InventoryWriteOffListItem) => (
                            <div
                              className="flex justify-end"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <WriteOffDeleteControl
                                writeOff={{
                                  id: row.id,
                                  reason: row.reason,
                                  status: row.status,
                                }}
                                onDeleted={() => {
                                  setSelectedIds((ids) => ids.filter((id) => id !== row.id))
                                  if (writeOffId === row.id) {
                                    closeWriteOff()
                                  }
                                  if (editDraftId === row.id) {
                                    setEditDraftId(null)
                                  }
                                }}
                              />
                            </div>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </>
        )
      })()}

      <WriteOffStockSheet open={createOpen} onOpenChange={setCreateOpen} />
      <WriteOffStockSheet
        open={Boolean(editDraftId)}
        draftId={editDraftId}
        onOpenChange={(open) => {
          if (!open) {
            setEditDraftId(null)
          }
        }}
      />
      <InventoryWriteOffSheet
        writeOffId={writeOffId}
        open={Boolean(writeOffId)}
        onOpenChange={(open) => {
          if (!open) {
            closeWriteOff()
          }
        }}
      />
    </div>
  )
}
