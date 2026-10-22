import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { CreatedPeriodFilter } from '@/components/shared/CreatedPeriodFilter'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { SelectionBulkBar } from '@/components/shared/SelectionBulkBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { activeFilterControlClass } from '@/components/shared/active-filter-style'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  DatePeriodPreset,
  isDatePeriodPreset,
  resolveDatePeriodBounds,
} from '@/lib/constants/date-period'
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
import {
  nextListSortDir,
  parseListSortColumn,
  parseListSortDir,
} from '@/lib/list-table-sort'
import { formatDate } from '@/lib/utils/date'
import { formatInteger } from '@/lib/utils/number'

import { SaleDetailSheet } from './SaleDetailScreen'
import { useCreateSale, useDeleteSale, useSales } from '../hooks/use-sales'
import type { SaleListItem, SaleSortColumn } from '../services/sales-service'

const SALE_SORT_COLUMNS = [
  'invoice',
  'customer',
  'date',
  'total',
  'status',
  'actor',
  'created',
] as const satisfies readonly SaleSortColumn[]

const DEFAULT_SALE_SORT: SaleSortColumn = 'created'
const DEFAULT_SALE_DIR = 'desc' as const

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
  const periodParam = searchParams.get('period')
  const period = periodParam && isDatePeriodPreset(periodParam) ? periodParam : DatePeriodPreset.All
  const periodFrom = searchParams.get('from')
  const periodTo = searchParams.get('to')
  const listSort = parseListSortColumn(
    searchParams.get('sort'),
    SALE_SORT_COLUMNS,
    DEFAULT_SALE_SORT,
  )
  const listDir = parseListSortDir(searchParams.get('dir'), DEFAULT_SALE_DIR)
  const filterKey = `${status}|${period}|${periodFrom ?? ''}|${periodTo ?? ''}|${listSort}|${listDir}`
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

  const salesQuery = useSales(debouncedSearch, status, page, pageSize, listSort, listDir, {
    period,
    from: periodFrom,
    to: periodTo,
    createdFrom: periodBounds.fromIso,
    createdTo: periodBounds.toExclusiveIso,
  })
  const create = useCreateSale()
  const remove = useDeleteSale()
  const saleId = searchParams.get('sale')
  const items = salesQuery.data?.items ?? []
  const total = salesQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const selectedOnPage = useMemo(
    () => items.filter((row) => selectedIds.includes(row.id)),
    [items, selectedIds],
  )
  const confirmedSelectedOnPage = selectedOnPage.filter((row) => row.status === SaleStatus.Confirmed)
  const canBulkDelete = selectedIds.length > 0 && confirmedSelectedOnPage.length < selectedIds.length
  const hasActiveFilters = status !== 'all' || period !== DatePeriodPreset.All || Boolean(debouncedSearch)

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

  function handleSort(columnId: string) {
    const column = parseListSortColumn(columnId, SALE_SORT_COLUMNS, DEFAULT_SALE_SORT)
    const nextDir = nextListSortDir(listSort, column, listDir, DEFAULT_SALE_DIR)
    const isDefault = column === DEFAULT_SALE_SORT && nextDir === DEFAULT_SALE_DIR
    patchFilters({
      sort: isDefault ? null : column,
      dir: isDefault ? null : nextDir,
    })
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
    if (selectedIds.length === 0) {
      return
    }
    setBulkPending(true)
    let deleted = 0
    const failedIds: string[] = []
    try {
      for (const id of selectedIds) {
        try {
          await remove.mutateAsync(id)
          deleted += 1
        } catch {
          failedIds.push(id)
        }
      }
      if (deleted === 0) {
        toast.error('Не удалось удалить выбранные счета. Подтверждённые продажи не удаляются.')
      } else {
        toast.success(
          deleted === 1 ? 'Счёт удалён' : `Удалено счетов: ${formatInteger(deleted)}`,
        )
        setBulkDeleteOpen(false)
        setSelectedIds(failedIds)
      }
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
          <SelectTrigger
            aria-label="Фильтр по статусу"
            className={activeFilterControlClass(status !== 'all', 'w-auto min-w-40')}
            onClear={status !== 'all' ? () => setStatus('all') : undefined}
            clearLabel="Сбросить фильтр по статусу"
          >
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
        <SelectionBulkBar
          count={selectedIds.length}
          onClear={() => setSelectedIds([])}
          pending={bulkPending}
        >
          {canDelete && canBulkDelete ? (
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
        emptyDescription={
          hasActiveFilters
            ? 'Нет продаж по выбранным фильтрам.'
            : 'Создайте счёт, укажите покупателя и подтвердите списание.'
        }
        onRowClick={(row) => openSale(row.id)}
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
            id: 'invoice',
            header: 'Счёт',
            sortable: true,
            cell: (row) => row.invoiceNumber,
          },
          {
            id: 'customer',
            header: 'Покупатель',
            sortable: true,
            cell: (row) => row.customerName || '—',
          },
          {
            id: 'date',
            header: 'Дата',
            sortable: true,
            cell: (row) => formatDate(row.saleDate),
          },
          {
            id: 'total',
            header: 'Сумма',
            sortable: true,
            cell: (row) => formatMoney(row.total),
          },
          {
            id: 'status',
            header: 'Статус',
            sortable: true,
            cell: (row) => (
              <StatusBadge tone={saleStatusTone(row.status)}>{saleStatusLabels[row.status]}</StatusBadge>
            ),
          },
          {
            id: 'actor',
            header: 'Оформил',
            sortable: true,
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
          selectedIds.length === 1
            ? (() => {
                const row = items.find((item) => item.id === selectedIds[0])
                const label = row?.invoiceNumber || 'Счёт'
                return `${label} будет удалён без возможности восстановления.`
              })()
            : `Будет удалено счетов: ${formatInteger(selectedIds.length)}. Подтверждённые продажи не удаляются.`
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
