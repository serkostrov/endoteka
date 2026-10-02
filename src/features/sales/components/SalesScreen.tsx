import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { SelectionBulkBar } from '@/components/shared/SelectionBulkBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { formatMoney } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import {
  SALES_SEARCH_DEBOUNCE_MS,
  SaleStatus,
  saleStatusLabels,
  saleStatusTone,
} from '@/lib/constants/sales'
import { getErrorMessage } from '@/lib/errors'
import { usePageSize } from '@/hooks/use-page-size'
import { formatDate } from '@/lib/utils/date'
import { formatInteger } from '@/lib/utils/number'

import { SaleDetailSheet } from './SaleDetailScreen'
import { useCreateSale, useDeleteSale, useSales } from '../hooks/use-sales'
import type { SaleListItem } from '../services/sales-service'

export function SalesScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const canCreate = useHasPermission(Permission.SalesCreate)
  const canDelete = useHasPermission(Permission.SalesDelete)
  const [deleteTarget, setDeleteTarget] = useState<SaleListItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkPending, setBulkPending] = useState(false)
  const debouncedSearch = useDebouncedValue(search, SALES_SEARCH_DEBOUNCE_MS)
  const salesQuery = useSales(debouncedSearch, status, page, pageSize)
  const create = useCreateSale()
  const remove = useDeleteSale()
  const saleId = searchParams.get('sale')
  const items = salesQuery.data?.items ?? []
  const total = salesQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const deletableSelected = useMemo(
    () => items.filter((row) => selectedIds.includes(row.id) && row.status !== SaleStatus.Confirmed),
    [items, selectedIds],
  )

  function openSale(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('sale', id)
    setSearchParams(next, { replace: true })
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
    setSelectedIds([])
  }

  async function handleCreate() {
    try {
      const id = await create.mutateAsync()
      toast.success('Счёт создан')
      openSale(id)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Счёт удалён')
      setSelectedIds((ids) => ids.filter((id) => id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleBulkDelete() {
    if (deletableSelected.length === 0) {
      return
    }
    setBulkPending(true)
    try {
      for (const row of deletableSelected) {
        await remove.mutateAsync(row.id)
      }
      toast.success(
        deletableSelected.length === 1
          ? 'Счёт удалён'
          : `Удалено счетов: ${formatInteger(deletableSelected.length)}`,
      )
      setBulkDeleteOpen(false)
      setSelectedIds([])
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBulkPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Продажи"
        description="Оформление счетов и продаж внешним клиентам."
      />

      <FilterBar
        end={
          canCreate ? (
            <Button type="button" disabled={create.isPending} onClick={() => void handleCreate()}>
              {create.isPending ? 'Создание…' : 'Новая продажа'}
            </Button>
          ) : null
        }
      >
        <SearchInput
          value={search}
          onChange={(next) => {
            setSearch(next)
            setPage(1)
            setSelectedIds([])
          }}
          label="Поиск продаж"
          placeholder="Номер счёта или покупатель"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
            setSelectedIds([])
          }}
        >
          <SelectTrigger aria-label="Фильтр по статусу">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent searchable>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.values(SaleStatus).map((code) => (
              <SelectItem key={code} value={code}>
                {saleStatusLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {selectedIds.length > 0 ? (
        <SelectionBulkBar
          count={selectedIds.length}
          onClear={() => setSelectedIds([])}
          pending={bulkPending}
        >
          {canDelete && deletableSelected.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              aria-label="Удалить"
              disabled={bulkPending}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </SelectionBulkBar>
      ) : null}

      <DataTable
        caption="Продажи"
        isLoading={salesQuery.isLoading}
        error={salesQuery.error ? getErrorMessage(salesQuery.error) : null}
        data={items}
        getRowId={(row) => row.id}
        emptyTitle="Продаж нет"
        emptyDescription="Создайте счёт, укажите покупателя и подтвердите списание."
        onRowClick={(row) => openSale(row.id)}
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
          { id: 'invoice', header: 'Счёт', cell: (row) => row.invoiceNumber },
          { id: 'customer', header: 'Покупатель', cell: (row) => row.customerName || '—' },
          { id: 'date', header: 'Дата', cell: (row) => formatDate(row.saleDate) },
          { id: 'total', header: 'Сумма', cell: (row) => formatMoney(row.total) },
          {
            id: 'status',
            header: 'Статус',
            cell: (row) => (
              <StatusBadge tone={saleStatusTone(row.status)}>{saleStatusLabels[row.status]}</StatusBadge>
            ),
          },
          {
            id: 'actor',
            header: 'Оформил',
            className: 'hidden md:table-cell',
            cell: (row) => row.createdByName || '—',
          },
          ...(canDelete
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: SaleListItem) => (
                    <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                      <IconActionButton
                        label={
                          row.status === SaleStatus.Confirmed
                            ? 'Подтверждённую продажу нельзя удалить'
                            : 'Удалить'
                        }
                        disabled={row.status === SaleStatus.Confirmed}
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(row)}
                      >
                        <Trash2 />
                      </IconActionButton>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить счёт"
        description={
          deleteTarget ? `${deleteTarget.invoiceNumber} будет удалён без возможности восстановления.` : ''
        }
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        onConfirm={() => void handleDelete()}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        title="Удалить счета"
        description={
          deletableSelected.length === 1
            ? `${deletableSelected[0]?.invoiceNumber} будет удалён без возможности восстановления.`
            : `Будет удалено счетов: ${formatInteger(deletableSelected.length)}. Подтверждённые продажи не удаляются.`
        }
        confirmLabel="Удалить"
        isPending={bulkPending || remove.isPending}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={() => void handleBulkDelete()}
      />
      <SaleDetailSheet
        saleId={saleId}
        open={Boolean(saleId)}
        onOpenChange={(open) => {
          if (!open) {
            const next = new URLSearchParams(searchParams)
            next.delete('sale')
            setSearchParams(next, { replace: true })
          }
        }}
      />
    </div>
  )
}
