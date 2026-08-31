import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { formatMoney } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { SERVICE_PAGE_SIZE, SERVICE_SEARCH_DEBOUNCE_MS } from '@/lib/constants/services'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { CreateServiceTemplateDialog } from './CreateServiceTemplateDialog'
import { EditServiceTemplateDialog } from './EditServiceTemplateDialog'
import { useDeleteServiceTemplate, useServiceTemplates } from '../hooks/use-services'
import type { ServiceTemplate } from '../services/services-service'

export function ServiceTemplatesScreen() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ServiceTemplate | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ServiceTemplate | null>(null)
  const canEdit = useHasPermission(Permission.SettingsUpdate)
  const debouncedSearch = useDebouncedValue(search, SERVICE_SEARCH_DEBOUNCE_MS)
  const listQuery = useServiceTemplates(debouncedSearch, page, SERVICE_PAGE_SIZE)
  const remove = useDeleteServiceTemplate()
  const total = listQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / SERVICE_PAGE_SIZE))

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Услуга удалена')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Шаблоны услуг"
        description="Справочник работ для состава заказа. Наименование уникально."
      />

      <FilterBar
        end={
          canEdit ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новая услуга
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
          label="Поиск услуг"
          placeholder="Наименование или описание"
        />
      </FilterBar>

      <DataTable
        caption="Услуги"
        isLoading={listQuery.isLoading}
        error={listQuery.error ? getErrorMessage(listQuery.error) : null}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Услуги не найдены"
        emptyDescription="Добавьте шаблон или измените запрос."
        onRowClick={canEdit ? (row) => setEditTarget(row) : undefined}
        pagination={{ page, pageCount, onPageChange: setPage }}
        columns={[
          { id: 'name', header: 'Наименование', cell: (row) => row.name },
          {
            id: 'description',
            header: 'Описание',
            className: 'hidden md:table-cell',
            cell: (row) => row.description || '—',
          },
          {
            id: 'price',
            header: 'Цена',
            cell: (row) => `${formatMoney(row.unitPrice)} ₽`,
          },
          ...(canEdit
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: ServiceTemplate) => (
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

      <CreateServiceTemplateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditServiceTemplateDialog
        item={editTarget}
        open={Boolean(editTarget)}
        onOpenChange={(next) => {
          if (!next) {
            setEditTarget(null)
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить услугу"
        description={
          deleteTarget
            ? `«${deleteTarget.name}» будет удалена. Если она есть в заказах, удаление не пройдёт.`
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
