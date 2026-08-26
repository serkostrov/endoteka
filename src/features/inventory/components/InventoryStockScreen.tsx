import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  INVENTORY_PAGE_SIZE,
  INVENTORY_SEARCH_DEBOUNCE_MS,
  formatQuantity,
} from '@/lib/constants/inventory'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { BarcodeScanInput } from './BarcodeScanInput'
import { useInventoryStock } from '../hooks/use-inventory'
import { findInventoryItemsByBarcode } from '../services/inventory-service'

export function InventoryStockScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const stockFilter = searchParams.get('stock') === 'zero' ? 'zero' : 'all'
  const filterKey = stockFilter
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey)
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey)
    setPage(1)
  }
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const stockQuery = useInventoryStock(debouncedSearch, page, INVENTORY_PAGE_SIZE, stockFilter)
  const navigate = useNavigate()
  const total = stockQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE))

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
        title="Остатки"
        description="Сколько товара сейчас на складе. Карточка позиции открывается из строки. Номенклатура (названия и штрихкоды) — в справочниках."
      />

      <FilterBar>
        <div className="w-full max-w-sm space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Сканер — открыть карточку по штрихкоду</p>
          <BarcodeScanInput className="max-w-none" onScan={(code) => void handleScan(code)} />
        </div>
        <div className="w-full max-w-sm space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Поиск по остаткам</p>
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
          <SelectTrigger aria-label="Фильтр по остатку">
            <SelectValue placeholder="Остаток" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все позиции</SelectItem>
            <SelectItem value="zero">Нет остатка</SelectItem>
          </SelectContent>
        </Select>
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
        pagination={{ page, pageCount, onPageChange: setPage }}
        columns={[
          { id: 'name', header: 'Наименование', cell: (row) => row.name },
          {
            id: 'article',
            header: 'Артикул',
            className: 'hidden md:table-cell',
            cell: (row) => row.article || '—',
          },
          {
            id: 'barcode',
            header: 'Штрихкод',
            className: 'hidden lg:table-cell',
            cell: (row) => row.barcode || '—',
          },
          {
            id: 'category',
            header: 'Категория',
            className: 'hidden md:table-cell',
            cell: (row) => row.categoryName || '—',
          },
          {
            id: 'stock',
            header: 'Остаток',
            cell: (row) => (
              <span className="font-medium">
                {formatQuantity(row.stockQuantity)} {row.unitName}
              </span>
            ),
          },
          {
            id: 'status',
            header: '',
            className: 'hidden sm:table-cell',
            cell: (row) =>
              row.stockQuantity <= 0 ? (
                <StatusBadge tone="warning">Нет остатка</StatusBadge>
              ) : (
                <StatusBadge tone="success">В наличии</StatusBadge>
              ),
          },
        ]}
      />
    </div>
  )
}
