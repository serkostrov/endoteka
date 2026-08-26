import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth, useHasPermission } from '@/features/auth'
import { useRoles } from '@/features/roles/hooks/use-roles'
import { Permission } from '@/lib/constants/permissions'
import { USER_PAGE_SIZE, USER_SEARCH_DEBOUNCE_MS } from '@/lib/constants/users'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { formatDate } from '@/lib/utils/date'
import { toast } from 'sonner'

import { EditUserDialog } from './EditUserDialog'
import { InviteUserDialog } from './InviteUserDialog'
import { useDeleteUserAccount } from '../hooks/use-user-mutations'
import { useUsers } from '../hooks/use-users'
import type { UserAccount } from '../services/users-service'

export function UsersScreen() {
  const { user } = useAuth()
  const canInvite = useHasPermission(Permission.UsersInvite)
  const canUpdate = useHasPermission(Permission.UsersUpdate)
  const [search, setSearch] = useState('')
  const [roleId, setRoleId] = useState('all')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [page, setPage] = useState(1)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null)
  const debouncedSearch = useDebouncedValue(search, USER_SEARCH_DEBOUNCE_MS)

  const usersQuery = useUsers({
    search: debouncedSearch,
    roleId,
    status,
    page,
    pageSize: USER_PAGE_SIZE,
  })
  const rolesQuery = useRoles()
  const deleteAccount = useDeleteUserAccount()
  const total = usersQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / USER_PAGE_SIZE))

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }

    try {
      await deleteAccount.mutateAsync(deleteTarget.id)
      toast.success('Сотрудник удалён')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Пользователи"
        description="Сотрудники сервисного центра, роли и статус доступа."
        actions={
          canInvite ? (
            <Button type="button" onClick={() => setInviteOpen(true)}>
              Пригласить
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={(next) => {
            setSearch(next)
            setPage(1)
          }}
          label="Поиск сотрудников"
          placeholder="Имя или email"
        />
        <Select
          value={roleId}
          onValueChange={(value) => {
            setRoleId(value)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Фильтр по роли">
            <SelectValue placeholder="Роль" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все роли</SelectItem>
            {(rolesQuery.data ?? []).map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as typeof status)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Фильтр по статусу">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="inactive">Отключённые</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        caption="Сотрудники"
        isLoading={usersQuery.isLoading}
        error={usersQuery.error ? getErrorMessage(usersQuery.error) : null}
        data={usersQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Сотрудники не найдены"
        emptyDescription="Измените фильтры или пригласите первого сотрудника."
        pagination={{ page, pageCount, onPageChange: setPage }}
        columns={[
          { id: 'name', header: 'Сотрудник', cell: (row) => row.fullName || '—' },
          { id: 'email', header: 'Email', cell: (row) => row.email || '—' },
          { id: 'role', header: 'Роль', cell: (row) => row.roleName || 'Не назначена' },
          {
            id: 'status',
            header: 'Статус',
            cell: (row) => (
              <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>
                {row.isActive ? 'Активен' : 'Отключён'}
              </StatusBadge>
            ),
          },
          { id: 'created', header: 'Создан', cell: (row) => formatDate(row.createdAt) },
          ...(canUpdate
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: UserAccount) => {
                    const isSelf = row.id === user?.id
                    return (
                      <div className="flex gap-1">
                        <IconActionButton label="Изменить" onClick={() => setEditTarget(row)}>
                          <Pencil />
                        </IconActionButton>
                        <IconActionButton
                          label={isSelf ? 'Нельзя удалить собственную учётную запись' : 'Удалить'}
                          disabled={isSelf}
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 />
                        </IconActionButton>
                      </div>
                    )
                  },
                },
              ]
            : []),
        ]}
      />

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <EditUserDialog
        user={editTarget}
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null)
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить сотрудника"
        description={
          deleteTarget
            ? `Учётная запись ${deleteTarget.fullName || deleteTarget.email} будет удалена без возможности восстановления.`
            : ''
        }
        confirmLabel="Удалить"
        isPending={deleteAccount.isPending}
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
