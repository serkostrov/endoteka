import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import {
  INVENTORY_PAGE_SIZE,
  INVENTORY_SEARCH_DEBOUNCE_MS,
  formatMoney,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { CreateItemDialog } from './CreateItemDialog'
import { EditItemDialog } from './EditItemDialog'
import { useDeleteInventoryItem, useInventoryStock } from '../hooks/use-inventory'
import type { InventoryItem } from '../services/inventory-service'

export function InventoryItemsScreen() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<InventoryItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null)
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const itemsQuery = useInventoryStock(debouncedSearch, page, INVENTORY_PAGE_SIZE)
  const remove = useDeleteInventoryItem()
  const navigate = useNavigate()
  const total = itemsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE))

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

      <DataTable
        caption="Номенклатура"
        isLoading={itemsQuery.isLoading}
        error={itemsQuery.error ? getErrorMessage(itemsQuery.error) : null}
        data={itemsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Позиции не найдены"
        emptyDescription="Добавьте позицию или измените запрос."
        onRowClick={(row) => navigate(routes.inventoryItem.replace(':id', row.id))}
        pagination={{ page, pageCount, onPageChange: setPage }}
        columns={[
          { id: 'name', header: 'Наименование', cell: (row) => row.name },
          { id: 'code', header: 'Код', cell: (row) => row.code },
          {
            id: 'article',
            header: 'Артикул',
            className: 'hidden md:table-cell',
            cell: (row) => row.article || '—',
          },
          {
            id: 'category',
            header: 'Категория',
            className: 'hidden md:table-cell',
            cell: (row) => row.categoryName,
          },
          { id: 'unit', header: 'Ед.', cell: (row) => row.unitName },
          {
            id: 'purchase',
            header: 'Закупка',
            className: 'hidden lg:table-cell',
            cell: (row) => formatMoney(row.purchasePrice),
          },
          ...(canReceive
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: InventoryItem) => (
                    <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                      <IconActionButton label="Изменить" onClick={() => setEditTarget(row)}>
                        <Pencil />
                      </IconActionButton>
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

      <CreateItemDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditItemDialog
        item={editTarget}
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null)
          }
        }}
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
