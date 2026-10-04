import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { FilterBar } from '@/components/shared/FilterBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { INVENTORY_SEARCH_DEBOUNCE_MS } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { CreateItemDialog } from './CreateItemDialog'
import { InventoryItemSheet } from './InventoryItemScreen'
import { InventoryRegistryTree } from './InventoryRegistryTree'

export function InventoryItemsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const itemId = searchParams.get('item')

  function openItem(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('item', id)
    next.delete('edit')
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Номенклатура"
        description="Каталог запчастей и расходников для склада и заказов."
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
          onChange={setSearch}
          label="Поиск номенклатуры"
          placeholder="Наименование, артикул, код, штрихкод"
        />
      </FilterBar>

      <InventoryRegistryTree search={debouncedSearch} onOpenItem={openItem} />

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
