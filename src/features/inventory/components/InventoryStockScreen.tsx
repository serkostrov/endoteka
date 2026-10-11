import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import { useReferenceItemsBySetCode } from '@/features/references/hooks/use-references'
import {
  INVENTORY_SEARCH_DEBOUNCE_MS,
  formatQuantity,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { ReferenceSetCode } from '@/lib/constants/references'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'

import { InventoryBulkActions } from './InventoryBulkActions'
import { InventoryItemCoverThumb } from './InventoryItemCoverThumb'
import { InventoryItemSheet } from './InventoryItemScreen'
import {
  useDeleteInventoryItem,
  useExportInventoryStock,
  useInventoryStock,
} from '../hooks/use-inventory'
import {
  buildStockExportWorkbook,
  downloadBlob,
  stockExportFilename,
} from '../lib/stock-export'
import type { InventoryItem } from '../services/inventory-service'

export function InventoryStockScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const stockParam = searchParams.get('stock')
  const stockFilter = stockParam === 'zero' || stockParam === 'in_stock' ? stockParam : 'all'
  const categoryId = searchParams.get('category') || null
  const itemId = searchParams.get('item')
  const filterKey = `${stockFilter}|${categoryId ?? ''}`
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey)
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey)
    setPage(1)
  }
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const categoriesQuery = useReferenceItemsBySetCode(ReferenceSetCode.InventoryCategories)
  const categoryOptions = useMemo(
    () => (categoriesQuery.data ?? []).filter((item) => item.isActive),
    [categoriesQuery.data],
  )
  const categorySelectValue =
    categoryId && categoryOptions.some((item) => item.id === categoryId) ? categoryId : 'all'
  const stockQuery = useInventoryStock(
    debouncedSearch,
    page,
    pageSize,
    stockFilter,
    categorySelectValue === 'all' ? null : categorySelectValue,
  )
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const canRead = useHasPermission(Permission.InventoryRead) || canReceive
  const exportStock = useExportInventoryStock()
  const remove = useDeleteInventoryItem()
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null)
  const items = stockQuery.data?.items ?? []
  const total = stockQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pageIdsKey = items.map((item) => item.id).join('|')
  const activeCategoryId = categorySelectValue === 'all' ? null : categorySelectValue

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

  async function handleExport() {
    try {
      const lines = await exportStock.mutateAsync({
        search: debouncedSearch,
        stockFilter,
        categoryId: activeCategoryId,
      })
      if (lines.length === 0) {
        toast.message('Нет позиций для экспорта по выбранным фильтрам')
        return
      }
      const blob = await buildStockExportWorkbook(lines)
      downloadBlob(blob, stockExportFilename())
      toast.success(`Экспортировано позиций: ${lines.length}`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Склад"
        description="Текущие остатки запчастей и расходников на складе."
        actions={
          canRead ? (
            <Button
              type="button"
              variant="outline"
              disabled={exportStock.isPending}
              onClick={() => void handleExport()}
            >
              <Download />
              {exportStock.isPending ? 'Экспорт…' : 'Экспорт'}
            </Button>
          ) : null
        }
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
          <p className="text-xs font-medium text-muted-foreground">Группа деталей</p>
          <Select
            value={categorySelectValue}
            onValueChange={(value) => {
              const next = new URLSearchParams(searchParams)
              if (value === 'all') {
                next.delete('category')
              } else {
                next.set('category', value)
              }
              setSearchParams(next, { replace: true })
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-label="Фильтр по группе деталей"
              className="h-9 w-52"
              onClear={
                categorySelectValue !== 'all'
                  ? () => {
                      const next = new URLSearchParams(searchParams)
                      next.delete('category')
                      setSearchParams(next, { replace: true })
                      setPage(1)
                    }
                  : undefined
              }
              clearLabel="Сбросить фильтр по группе"
            >
              <SelectValue placeholder="Группа деталей" />
            </SelectTrigger>
            <SelectContent searchable>
              <SelectItem value="all">Все группы</SelectItem>
              {categoryOptions.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <SelectTrigger
              aria-label="Фильтр по остатку"
              className="h-9 w-44"
              onClear={
                stockFilter !== 'all'
                  ? () => {
                      const next = new URLSearchParams(searchParams)
                      next.delete('stock')
                      setSearchParams(next, { replace: true })
                      setPage(1)
                    }
                  : undefined
              }
              clearLabel="Сбросить фильтр по остатку"
            >
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
              <StatusBadge
                tone={
                  row.stockQuantity < 0 ? 'danger' : row.stockQuantity === 0 ? 'warning' : 'success'
                }
                className="tabular-nums"
              >
                {`${formatQuantity(row.stockQuantity)} ${row.unitName}`}
              </StatusBadge>
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
