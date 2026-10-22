import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
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
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const canWriteOff = useHasPermission(Permission.InventoryWriteOff)
  const listSort = parseListSortColumn(
    searchParams.get('sort'),
    WRITE_OFF_SORT_COLUMNS,
    DEFAULT_WRITE_OFF_SORT,
  )
  const listDir = parseListSortDir(searchParams.get('dir'), DEFAULT_WRITE_OFF_DIR)
  const sortKey = `${listSort}|${listDir}`
  const [seenSortKey, setSeenSortKey] = useState(sortKey)
  if (seenSortKey !== sortKey) {
    setSeenSortKey(sortKey)
    setPage(1)
    setSelectedIds([])
  }
  const writeOffsQuery = useInventoryWriteOffs(page, pageSize, listSort, listDir)
  const writeOffId = searchParams.get('writeOff')
  const total = writeOffsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

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
    const next = new URLSearchParams(searchParams)
    if (isDefault) {
      next.delete('sort')
      next.delete('dir')
    } else {
      next.set('sort', column)
      next.set('dir', nextDir)
    }
    setSearchParams(next, { replace: true })
  }

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

      {selectedIds.length > 0 ? (
        <WriteOffBulkActions selectedIds={selectedIds} onClear={() => setSelectedIds([])} />
      ) : null}

      <DataTable
        caption="Списания"
        isLoading={writeOffsQuery.isLoading}
        error={writeOffsQuery.error ? getErrorMessage(writeOffsQuery.error) : null}
        data={writeOffsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Списаний нет"
        emptyDescription="Оформите списание, чтобы уменьшить остаток на складе."
        onRowClick={(row) => openWriteOff(row.id)}
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
            id: 'reason',
            header: 'Причина',
            sortable: true,
            cell: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.reason}</p>
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
            className: 'hidden md:table-cell',
            cell: (row) => row.actorName || '—',
          },
          {
            id: 'created',
            header: 'Создан',
            sortable: true,
            className: 'hidden lg:table-cell',
            cell: (row) => formatDateTime(row.createdAt),
          },
          ...(canWriteOff
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: InventoryWriteOffListItem) => (
                    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                      <WriteOffDeleteControl
                        writeOff={{ id: row.id, reason: row.reason }}
                        onDeleted={() => {
                          setSelectedIds((ids) => ids.filter((id) => id !== row.id))
                          if (writeOffId === row.id) {
                            closeWriteOff()
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

      <WriteOffStockSheet open={createOpen} onOpenChange={setCreateOpen} />
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
