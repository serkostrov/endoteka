import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { FilterBar } from '@/components/shared/FilterBar'
import { FolderTree, FolderTreeItemButton, groupByFolderKey } from '@/components/shared/FolderTree'
import { ListPagination } from '@/components/shared/ListPagination'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import {
  INVENTORY_SEARCH_DEBOUNCE_MS,
  formatMoney,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'

import { CreateItemDialog } from './CreateItemDialog'
import { InventoryItemSheet } from './InventoryItemScreen'
import { useInventoryStock } from '../hooks/use-inventory'
import type { InventoryItem } from '../services/inventory-service'

export function InventoryItemsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [createOpen, setCreateOpen] = useState(false)
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const itemsQuery = useInventoryStock(debouncedSearch, page, pageSize)
  const itemId = searchParams.get('item')
  const items = itemsQuery.data?.items ?? []

  const groups = useMemo(
    () =>
      groupByFolderKey(items, (item) => ({
        id: `category:${item.categoryId || item.categoryName || 'none'}`,
        name: item.categoryName.trim() || 'Без категории',
      })),
    [items],
  )

  function openItem(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('item', id)
    next.delete('edit')
    setSearchParams(next, { replace: true })
  }

  const total = itemsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Номенклатура"
        description="Справочник запчастей и расходников. Наименование уникально."
      />

      <FilterBar
        end={
          canReceive ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новая позиция
            </Button>
          ) : null
        }
      >
        <SearchInput
          value={search}
          onChange={(next) => {
            setSearch(next)
            setPage(1)
          }}
          label="Поиск номенклатуры"
          placeholder="Наименование, артикул, код, штрихкод"
        />
      </FilterBar>

      {itemsQuery.isLoading ? (
        <LoadingState label="Загрузка номенклатуры" className="min-h-40" />
      ) : itemsQuery.error ? (
        <ErrorState description={getErrorMessage(itemsQuery.error)} />
      ) : (
        <FolderTree
          groups={groups}
          getItemId={(item) => item.id}
          empty={
            <EmptyState
              title="Позиции не найдены"
              description="Добавьте позицию или измените запрос."
              className="rounded-md border py-12"
            />
          }
          renderItem={(item: InventoryItem) => (
            <FolderTreeItemButton depth={1} onClick={() => openItem(item.id)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {[item.code, item.article].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              <span className="hidden w-12 shrink-0 text-muted-foreground sm:block">{item.unitName}</span>
              <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatMoney(item.purchasePrice)}
              </span>
            </FolderTreeItemButton>
          )}
        />
      )}

      {pageCount > 1 || Boolean(pageSize) ? (
        <ListPagination
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
          pageSize={pageSize}
          onPageSizeChange={handlePageSizeChange}
        />
      ) : null}

      <CreateItemDialog open={createOpen} onOpenChange={setCreateOpen} />
      <InventoryItemSheet
        itemId={itemId}
        open={Boolean(itemId)}
        onOpenChange={(open) => {
          if (!open) {
            const next = new URLSearchParams(searchParams)
            next.delete('item')
            next.delete('edit')
            setSearchParams(next, { replace: true })
          }
        }}
      />
    </div>
  )
}
