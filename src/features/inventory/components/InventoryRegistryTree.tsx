import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { FolderBlock, FolderTreeItemButton } from '@/components/shared/FolderTree'
import { LoadingState } from '@/components/shared/LoadingState'
import { formatMoney } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'

import { InventoryItemCoverThumb } from './InventoryItemCoverThumb'
import {
  useInventoryRegistryCategories,
  useInventoryRegistryItems,
} from '../hooks/use-inventory'
import type { InventoryItem } from '../services/inventory-service'

type InventoryRegistryTreeProps = {
  search: string
  onOpenItem: (id: string) => void
}

export function InventoryRegistryTree({ search, onOpenItem }: InventoryRegistryTreeProps) {
  const categoriesQuery = useInventoryRegistryCategories(search)
  const categories = categoriesQuery.data ?? []
  const expandAll = Boolean(search.trim())
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setExpanded({})
  }, [search])

  if (categoriesQuery.isLoading) {
    return <LoadingState label="Загрузка номенклатуры" className="min-h-40" />
  }
  if (categoriesQuery.error) {
    return <ErrorState description={getErrorMessage(categoriesQuery.error)} />
  }
  if (categories.length === 0) {
    return (
      <EmptyState
        title="Позиции не найдены"
        description="Добавьте позицию или измените запрос."
        className="rounded-md border py-12"
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-md border">
      {categories.map((category) => {
        const open =
          Object.prototype.hasOwnProperty.call(expanded, category.key)
            ? Boolean(expanded[category.key])
            : expandAll
        return (
          <FolderBlock
            key={category.key}
            title={category.name}
            count={category.count}
            open={open}
            depth={0}
            onToggle={() =>
              setExpanded((current) => ({
                ...current,
                [category.key]: !open,
              }))
            }
          >
            {open ? (
              <CategoryItemList
                search={search}
                categoryKey={category.key}
                onOpenItem={onOpenItem}
              />
            ) : null}
          </FolderBlock>
        )
      })}
    </div>
  )
}

function CategoryItemList({
  search,
  categoryKey,
  onOpenItem,
}: {
  search: string
  categoryKey: string
  onOpenItem: (id: string) => void
}) {
  const itemsQuery = useInventoryRegistryItems(search, categoryKey)
  const items = itemsQuery.data ?? []

  if (itemsQuery.isLoading) {
    return <LoadingState label="Загрузка позиций" className="min-h-16 py-4" />
  }
  if (itemsQuery.error) {
    return (
      <p className="px-3 py-3 text-sm text-destructive">{getErrorMessage(itemsQuery.error)}</p>
    )
  }
  if (items.length === 0) {
    return <p className="px-3 py-3 text-sm text-muted-foreground">В категории нет позиций</p>
  }

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <ItemRow item={item} onOpen={() => onOpenItem(item.id)} />
        </li>
      ))}
    </ul>
  )
}

function ItemRow({ item, onOpen }: { item: InventoryItem; onOpen: () => void }) {
  return (
    <FolderTreeItemButton depth={1} onClick={onOpen}>
      <InventoryItemCoverThumb src={item.coverUrl} alt={item.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {[item.code, item.article].filter(Boolean).join(' ') || '—'}
        </span>
      </span>
      <span className="hidden w-12 shrink-0 text-muted-foreground sm:block">{item.unitName}</span>
      <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
        {formatMoney(item.purchasePrice)}
      </span>
    </FolderTreeItemButton>
  )
}
