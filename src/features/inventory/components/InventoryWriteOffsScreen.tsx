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
import { formatDate, formatDateTime } from '@/lib/utils/date'

import { InventoryWriteOffSheet } from './InventoryWriteOffSheet'
import { WriteOffBulkActions } from './WriteOffBulkActions'
import { WriteOffDeleteControl } from './WriteOffDeleteControl'
import { WriteOffStockSheet } from './WriteOffStockSheet'
import { useInventoryWriteOffs } from '../hooks/use-inventory'
import type { InventoryWriteOffListItem } from '../services/inventory-service'

export function InventoryWriteOffsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const canWriteOff = useHasPermission(Permission.InventoryWriteOff)
  const writeOffsQuery = useInventoryWriteOffs(page, pageSize)
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
          onPageChange: (next) => {
            setPage(next)
            setSelectedIds([])
          },
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
        columns={[
          { id: 'date', header: 'Дата', cell: (row) => formatDate(row.writeOffDate) },
          {
            id: 'reason',
            header: 'Причина',
            cell: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.reason}</p>
                {row.notes ? (
                  <p className="truncate text-xs text-muted-foreground">{row.notes}</p>
                ) : null}
              </div>
            ),
          },
          { id: 'lines', header: 'Строк', cell: (row) => String(row.lineCount) },
          { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(row.totalQuantity) },
          {
            id: 'amount',
            header: 'Сумма',
            className: 'tabular-nums',
            cell: (row) => formatMoney(row.totalAmount),
          },
          {
            id: 'actor',
            header: 'Кто',
            className: 'hidden md:table-cell',
            cell: (row) => row.actorName || '—',
          },
          {
            id: 'created',
            header: 'Создан',
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
