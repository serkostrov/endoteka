import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { toast } from 'sonner'

import { CreatedPeriodFilter } from '@/components/shared/CreatedPeriodFilter'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SupplierLink } from '@/components/shared/SupplierLink'
import { activeFilterControlClass } from '@/components/shared/active-filter-style'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import {
  DatePeriodPreset,
  isDatePeriodPreset,
  resolveDatePeriodBounds,
} from '@/lib/constants/date-period'
import {
  formatQuantity,
  InventoryReceiptStatus,
  inventoryReceiptStatusLabels,
  inventoryReceiptStatusTone,
  isInventoryReceiptStatus,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { usePageSize } from '@/hooks/use-page-size'
import { formatDate, formatDateTime } from '@/lib/utils/date'

import { InventoryReceiptSheet } from './InventoryReceiptSheet'
import { ReceiveStockSheet } from './ReceiveStockSheet'
import { ReceiptBulkActions } from './ReceiptBulkActions'
import { ReceiptDeleteControl } from './ReceiptDeleteControl'
import { useExportInventoryReceipts, useInventoryReceipts } from '../hooks/use-inventory'
import {
  buildReceiptExportWorkbook,
  downloadBlob,
  receiptExportFilename,
} from '../lib/receipt-export'
import type { InventoryReceiptListItem } from '../services/inventory-service'

export function InventoryReceiptsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [createOpen, setCreateOpen] = useState(false)
  const [editDraftId, setEditDraftId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const canRead = useHasPermission(Permission.InventoryRead) || canReceive
  const exportReceipts = useExportInventoryReceipts()

  const statusParam = searchParams.get('status')
  const statusFilter =
    statusParam && isInventoryReceiptStatus(statusParam) ? statusParam : 'all'
  const periodParam = searchParams.get('period')
  const period = periodParam && isDatePeriodPreset(periodParam) ? periodParam : DatePeriodPreset.All
  const periodFrom = searchParams.get('from')
  const periodTo = searchParams.get('to')

  const filterKey = `${statusFilter}|${period}|${periodFrom ?? ''}|${periodTo ?? ''}`
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey)
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey)
    setPage(1)
    setSelectedIds([])
  }

  const periodBounds = useMemo(
    () => resolveDatePeriodBounds(period, periodFrom, periodTo),
    [period, periodFrom, periodTo],
  )

  const listFilters = useMemo(
    () => ({
      status: statusFilter,
      period,
      from: periodFrom,
      to: periodTo,
      createdFrom: periodBounds.fromIso,
      createdTo: periodBounds.toExclusiveIso,
    }),
    [statusFilter, period, periodFrom, periodTo, periodBounds.fromIso, periodBounds.toExclusiveIso],
  )

  const receiptsQuery = useInventoryReceipts(page, pageSize, listFilters)
  const receiptId = searchParams.get('receipt')
  const total = receiptsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  async function handleExport() {
    try {
      const lines = await exportReceipts.mutateAsync({
        status: listFilters.status,
        createdFrom: listFilters.createdFrom,
        createdTo: listFilters.createdTo,
      })
      if (lines.length === 0) {
        toast.message('Нет строк для экспорта по выбранным фильтрам')
        return
      }
      const blob = await buildReceiptExportWorkbook(lines)
      downloadBlob(blob, receiptExportFilename())
      toast.success(`Экспортировано строк: ${lines.length}`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

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

  function openReceipt(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('receipt', id)
    setSearchParams(next, { replace: true })
  }

  function closeReceipt() {
    const next = new URLSearchParams(searchParams)
    next.delete('receipt')
    setSearchParams(next, { replace: true })
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
    setSelectedIds([])
  }

  function handleRowClick(row: InventoryReceiptListItem) {
    if (row.status === InventoryReceiptStatus.Draft) {
      if (canReceive) {
        setEditDraftId(row.id)
      }
      return
    }
    openReceipt(row.id)
  }

  useEffect(() => {
    if (!receiptId || !canReceive || !receiptsQuery.data) {
      return
    }
    const row = receiptsQuery.data.items.find((item) => item.id === receiptId)
    if (row?.status !== InventoryReceiptStatus.Draft) {
      return
    }
    setEditDraftId(receiptId)
    closeReceipt()
  }, [receiptId, canReceive, receiptsQuery.data])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Приходы"
        description="Документы поступления товара на склад."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canRead ? (
              <Button
                type="button"
                variant="outline"
                disabled={exportReceipts.isPending}
                onClick={() => void handleExport()}
              >
                <Download />
                {exportReceipts.isPending ? 'Экспорт…' : 'Экспорт'}
              </Button>
            ) : null}
            {canReceive ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                Новый приход
              </Button>
            ) : null}
          </div>
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
            <SelectItem value={InventoryReceiptStatus.Draft}>
              <StatusBadge tone={inventoryReceiptStatusTone(InventoryReceiptStatus.Draft)}>
                {inventoryReceiptStatusLabels.draft}
              </StatusBadge>
            </SelectItem>
            <SelectItem value={InventoryReceiptStatus.Posted}>
              <StatusBadge tone={inventoryReceiptStatusTone(InventoryReceiptStatus.Posted)}>
                {inventoryReceiptStatusLabels.posted}
              </StatusBadge>
            </SelectItem>
          </SelectContent>
        </Select>

        <CreatedPeriodFilter
          value={{
            preset: period,
            from: periodFrom,
            to: periodTo,
          }}
          onChange={(next) =>
            patchFilters({
              period: next.preset === DatePeriodPreset.All ? null : next.preset,
              from: next.preset === DatePeriodPreset.Custom ? next.from : null,
              to: next.preset === DatePeriodPreset.Custom ? next.to : null,
            })
          }
        />
      </FilterBar>

      {selectedIds.length > 0 ? (
        <ReceiptBulkActions selectedIds={selectedIds} onClear={() => setSelectedIds([])} />
      ) : null}

      <DataTable
        caption="Приходы"
        isLoading={receiptsQuery.isLoading}
        error={receiptsQuery.error ? getErrorMessage(receiptsQuery.error) : null}
        data={receiptsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Приходов нет"
        emptyDescription={
          statusFilter !== 'all' || period !== DatePeriodPreset.All
            ? 'Нет приходов по выбранным фильтрам.'
            : 'Оформите поступление, чтобы появились партии.'
        }
        onRowClick={handleRowClick}
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
          { id: 'date', header: 'Дата', cell: (row) => formatDate(row.receiptDate) },
          {
            id: 'status',
            header: 'Статус',
            cell: (row) => (
              <StatusBadge tone={inventoryReceiptStatusTone(row.status)}>
                {inventoryReceiptStatusLabels[row.status]}
              </StatusBadge>
            ),
          },
          {
            id: 'supplier',
            header: 'Поставщик',
            cell: (row) =>
              row.supplier ? (
                <SupplierLink name={row.supplier} customerId={row.supplierId} />
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          { id: 'lines', header: 'Строк', cell: (row) => String(row.lineCount) },
          { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(row.totalQuantity) },
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
          ...(canReceive
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: InventoryReceiptListItem) => (
                    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                      <ReceiptDeleteControl
                        receipt={{ id: row.id, supplier: row.supplier, status: row.status }}
                        onDeleted={() => {
                          setSelectedIds((ids) => ids.filter((id) => id !== row.id))
                          if (receiptId === row.id) {
                            closeReceipt()
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

      <ReceiveStockSheet open={createOpen} onOpenChange={setCreateOpen} />
      <ReceiveStockSheet
        open={Boolean(editDraftId)}
        draftId={editDraftId}
        onOpenChange={(open) => {
          if (!open) {
            setEditDraftId(null)
          }
        }}
      />
      <InventoryReceiptSheet
        receiptId={receiptId}
        open={Boolean(receiptId)}
        onOpenChange={(open) => {
          if (!open) {
            closeReceipt()
          }
        }}
      />
    </div>
  )
}
