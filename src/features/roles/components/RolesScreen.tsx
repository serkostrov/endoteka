import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { getErrorMessage } from '@/lib/errors'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'

import { CreateRoleSheet } from './CreateRoleSheet'
import { EditRoleSheet } from './EditRoleSheet'
import { useDeleteRole, useRoles } from '../hooks/use-roles'
import type { RoleRecord } from '../services/roles-service'

export function RolesScreen() {
  const rolesQuery = useRoles()
  const canUpdate = useHasPermission(Permission.RolesUpdate)
  const remove = useDeleteRole()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<RoleRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RoleRecord | null>(null)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const items = rolesQuery.data ?? []
    if (!query) {
      return items
    }
    return items.filter(
      (role) =>
        role.name.toLowerCase().includes(query) ||
        (role.description ?? '').toLowerCase().includes(query) ||
        role.code.toLowerCase().includes(query),
    )
  }, [rolesQuery.data, search])

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Роль удалена')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Роли и права" description="Настройка прав доступа по ролям сотрудников." />

      <FilterBar
        end={
          canUpdate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новая роль
            </Button>
          ) : null
        }
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          label="Поиск ролей"
          placeholder="Название или описание"
        />
      </FilterBar>

      <DataTable
        caption="Роли"
        isLoading={rolesQuery.isLoading}
        error={rolesQuery.error ? getErrorMessage(rolesQuery.error) : null}
        data={filtered}
        getRowId={(row) => row.id}
        emptyTitle={search.trim() ? 'Ничего не найдено' : 'Роли не найдены'}
        emptyDescription={
          search.trim()
            ? 'Измените запрос или сбросьте поиск.'
            : canUpdate
              ? 'Создайте первую роль для настройки доступа.'
              : 'Роли появятся после применения миграций базы данных.'
        }
        columns={[
          {
            id: 'name',
            header: 'Роль',
            cell: (row) => (
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`${routes.roles}/${row.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {row.name}
                </Link>
                {row.isSystem ? (
                  <Badge variant="secondary" className="font-normal">
                    Системная
                  </Badge>
                ) : null}
              </div>
            ),
          },
          { id: 'description', header: 'Описание', cell: (row) => row.description || '—' },
          ...(canUpdate
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: RoleRecord) => (
                    <div className="flex gap-1">
                      <IconActionButton label="Изменить" onClick={() => setEditTarget(row)}>
                        <Pencil />
                      </IconActionButton>
                      {!row.isSystem ? (
                        <IconActionButton
                          label="Удалить"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 />
                        </IconActionButton>
                      ) : null}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />

      <CreateRoleSheet open={createOpen} onOpenChange={setCreateOpen} />
      <EditRoleSheet
        role={editTarget}
        open={Boolean(editTarget)}
        onOpenChange={(next) => {
          if (!next) {
            setEditTarget(null)
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить роль"
        description={
          deleteTarget
            ? `«${deleteTarget.name}» будет удалена безвозвратно. Если роль назначена сотрудникам или есть приглашения, удаление не пройдёт.`
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
