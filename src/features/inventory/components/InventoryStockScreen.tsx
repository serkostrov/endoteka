import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'

import { BarcodeScanInput } from './BarcodeScanInput'
import { useDeleteInventoryItem, useInventoryStock } from '../hooks/use-inventory'
import { findInventoryItemsByBarcode, type InventoryItem } from '../services/inventory-service'

export function InventoryStockScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const stockFilter = searchParams.get('stock') === 'zero' ? 'zero' : 'all'
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
  const navigate = useNavigate()
  const total = stockQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

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
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleScan(code: string) {
    try {
      const items = await findInventoryItemsByBarcode(code)
      const match = items[0]
      if (items.length === 1 && match) {
        navigate(routes.inventoryItem.replace(':id', match.id))
        return
      }
      if (items.length === 0) {
        toast.error('Позиция со штрихкодом не найдена')
        setSearch(code)
        setPage(1)
        return
      }
      setSearch(code)
      setPage(1)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Склад"
        description="Текущий остаток по журналу движений. Карточка позиции открывается из строки или по штрихкоду."
      />

      <FilterBar>
        <div className="min-w-0 w-full max-w-sm space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Сканер</p>
          <BarcodeScanInput
            className="max-w-none"
            onScan={(code) => void handleScan(code)}
            placeholder="Штрихкод — Enter"
          />
        </div>
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
              if (value === 'zero') {
                next.set('stock', 'zero')
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
            <SelectContent>
              <SelectItem value="all">Все позиции</SelectItem>
              <SelectItem value="zero">Нет остатка</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterBar>

      <DataTable
        caption="Остатки"
        isLoading={stockQuery.isLoading}
        error={stockQuery.error ? getErrorMessage(stockQuery.error) : null}
        data={stockQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Позиции не найдены"
        emptyDescription={
          stockFilter === 'zero' ? 'Нет позиций с нулевым остатком.' : 'Измените запрос или оформите приход.'
        }
        onRowClick={(row) => navigate(routes.inventoryItem.replace(':id', row.id))}
        pagination={{
          page,
          pageCount,
          onPageChange: setPage,
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
        columns={[
          { id: 'name', header: 'Наименование', className: 'min-w-[12rem]', cell: (row) => row.name },
          {
            id: 'article',
            header: 'Артикул',
            className: 'hidden w-[1%] md:table-cell',
            cell: (row) => row.article || '—',
          },
          {
            id: 'barcode',
            header: 'Штрихкод',
            className: 'hidden w-[1%] lg:table-cell',
            cell: (row) => row.barcode || '—',
          },
          {
            id: 'category',
            header: 'Категория',
            className: 'hidden w-[1%] md:table-cell',
            cell: (row) => row.categoryName || '—',
          },
          {
            id: 'stock',
            header: 'Остаток',
            className: 'w-[1%]',
            cell: (row) => (
              <span className="font-medium">
                {formatQuantity(row.stockQuantity)} {row.unitName}
              </span>
            ),
          },
          {
            id: 'status',
            header: '',
            className: 'hidden w-[1%] sm:table-cell',
            cell: (row) =>
              row.stockQuantity <= 0 ? (
                <StatusBadge tone="warning">Нет остатка</StatusBadge>
              ) : (
                <StatusBadge tone="success">В наличии</StatusBadge>
              ),
          },
          ...(canReceive
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
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
    </div>
  )
}
