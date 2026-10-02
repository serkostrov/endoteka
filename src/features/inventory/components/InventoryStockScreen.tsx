import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import {
  INVENTORY_SEARCH_DEBOUNCE_MS,
  formatQuantity,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'

import { InventoryBulkActions } from './InventoryBulkActions'
import { InventoryItemCoverThumb } from './InventoryItemCoverThumb'
import { InventoryItemSheet } from './InventoryItemScreen'
import { useDeleteInventoryItem, useInventoryStock } from '../hooks/use-inventory'
import type { InventoryItem } from '../services/inventory-service'

export function InventoryStockScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const stockParam = searchParams.get('stock')
  const stockFilter = stockParam === 'zero' || stockParam === 'in_stock' ? stockParam : 'all'
  const itemId = searchParams.get('item')
  const filterKey = stockFilter
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey)
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey)
    setPage(1)
  }
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const stockQuery = useInventoryStock(debouncedSearch, page, pageSize, stockFilter)
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const remove = useDeleteInventoryItem()
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null)
  const items = stockQuery.data?.items ?? []
  const total = stockQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pageIdsKey = items.map((item) => item.id).join('|')

  useEffect(() => {
    const visible = new Set(pageIdsKey ? pageIdsKey.split('|') : [])
    setSelectedIds((current) => {
      const next = current.filter((id) => visible.has(id))
      return next.length === current.length ? current : next
    })
  }, [pageIdsKey])

  function openItem(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('item', id)
    setSearchParams(next, { replace: true })
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Позиция удалена')
      setDeleteTarget(null)
      setSelectedIds((current) => current.filter((id) => id !== deleteTarget.id))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Склад"
        description="Текущие остатки запчастей и расходников на складе."
      />

      <FilterBar>
        <div className="min-w-0 w-full max-w-sm space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Поиск</p>
          <SearchInput
            value={search}
            onChange={(next) => {
              setSearch(next)
              setPage(1)
            }}
            label="Поиск по складу"
            placeholder="Наименование, артикул, код, штрихкод"
            className="max-w-none"
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Остаток</p>
          <Select
            value={stockFilter}
            onValueChange={(value) => {
              const next = new URLSearchParams(searchParams)
              if (value === 'zero' || value === 'in_stock') {
                next.set('stock', value)
              } else {
                next.delete('stock')
              }
              setSearchParams(next, { replace: true })
              setPage(1)
            }}
          >
            <SelectTrigger aria-label="Фильтр по остатку" className="h-9 w-44">
              <SelectValue placeholder="Остаток" />
            </SelectTrigger>
            <SelectContent searchable>
              <SelectItem value="all">Все позиции</SelectItem>
              <SelectItem value="in_stock">В наличии</SelectItem>
              <SelectItem value="zero">Нет остатка</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterBar>

      {selectedIds.length > 0 ? (
        <InventoryBulkActions selectedIds={selectedIds} onClear={() => setSelectedIds([])} />
      ) : null}

      <DataTable
        caption="Остатки"
        isLoading={stockQuery.isLoading}
        error={stockQuery.error ? getErrorMessage(stockQuery.error) : null}
        data={items}
        getRowId={(row) => row.id}
        emptyTitle="Позиции не найдены"
        emptyDescription={
          stockFilter === 'zero'
            ? 'Нет позиций с нулевым остатком.'
            : stockFilter === 'in_stock'
              ? 'Нет позиций в наличии.'
              : 'Измените запрос или оформите приход.'
        }
        onRowClick={(row) => openItem(row.id)}
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
        columns={[
          {
            id: 'name',
            header: 'Наименование',
            className: 'min-w-[14rem]',
            cell: (row) => (
              <div className="flex min-w-0 items-center gap-3">
                <InventoryItemCoverThumb src={row.coverUrl} alt={row.name} />
                <div className="min-w-0">
                  <p className="truncate font-medium leading-snug">{row.name}</p>
                  {row.barcode ? (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {row.barcode}
                    </p>
                  ) : null}
                </div>
              </div>
            ),
          },
          {
            id: 'code',
            header: 'Код',
            className: 'hidden w-[10.5rem] md:table-cell',
            cell: (row) => (
              <span className="block max-w-[15ch] truncate font-mono text-xs tabular-nums text-muted-foreground">
                {row.code || '—'}
              </span>
            ),
          },
          {
            id: 'article',
            header: 'Артикул',
            className: 'hidden w-[10.5rem] md:table-cell',
            cell: (row) => (
              <span className="block max-w-[15ch] truncate font-mono text-xs tabular-nums text-muted-foreground">
                {row.article || '—'}
              </span>
            ),
          },
          {
            id: 'category',
            header: 'Категория',
            className: 'hidden w-[8rem] lg:table-cell',
            cell: (row) => (
              <span className="block truncate text-sm text-muted-foreground">
                {row.categoryName || '—'}
              </span>
            ),
          },
          {
            id: 'stock',
            header: 'Остаток',
            className: 'w-[1%] whitespace-nowrap text-right',
            cell: (row) => (
              <div className="inline-flex flex-col items-end gap-0.5">
                {row.stockQuantity < 0 ? (
                  <StatusBadge tone="warning">Недостача</StatusBadge>
                ) : row.stockQuantity <= 0 ? (
                  <StatusBadge tone="warning">Нет остатка</StatusBadge>
                ) : (
                  <StatusBadge tone="success">В наличии</StatusBadge>
                )}
                <span
                  className={
                    row.stockQuantity < 0
                      ? 'text-xs font-medium tabular-nums text-destructive'
                      : 'text-xs tabular-nums text-muted-foreground'
                  }
                >
                  {formatQuantity(row.stockQuantity)} {row.unitName}
                </span>
              </div>
            ),
          },
          ...(canReceive
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap text-right',
                  cell: (row: InventoryItem) => (
                    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                      <IconActionButton
                        label="Удалить"
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
        title="Удалить позицию"
        description={
          deleteTarget
            ? `${deleteTarget.name} будет удалена. Если по ней есть партии, движения или документы, удаление не пройдёт.`
            : ''
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
      <InventoryItemSheet
        itemId={itemId}
        open={Boolean(itemId)}
        onOpenChange={(open) => {
          if (!open) {
            const next = new URLSearchParams(searchParams)
            next.delete('item')
            setSearchParams(next, { replace: true })
          }
        }}
      />
    </div>
  )
}
