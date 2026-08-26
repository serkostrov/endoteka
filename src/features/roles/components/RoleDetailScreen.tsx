import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { useAuth, useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { toast } from 'sonner'

import { PermissionMatrix } from './PermissionMatrix'
import { useRolePermissions, useRoles, useSaveRolePermissions } from '../hooks/use-roles'

export function RoleDetailScreen() {
  const { id: roleId } = useParams()
  const { refreshUser } = useAuth()
  const canUpdate = useHasPermission(Permission.RolesUpdate)
  const rolesQuery = useRoles()
  const permissionsQuery = useRolePermissions(roleId)
  const save = useSaveRolePermissions(roleId ?? '')
  const [draft, setDraft] = useState<Permission[] | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const selected = draft ?? permissionsQuery.data ?? []
  const role = rolesQuery.data?.find((item) => item.id === roleId)
  const isDirty =
    draft !== null &&
    (draft.length !== (permissionsQuery.data?.length ?? 0) ||
      draft.some((code) => !permissionsQuery.data?.includes(code)))

  if (permissionsQuery.isLoading || rolesQuery.isLoading) {
    return <LoadingState label="Загружаем матрицу прав…" />
  }

  if (permissionsQuery.error) {
    return <ErrorState description={getErrorMessage(permissionsQuery.error)} />
  }

  if (!roleId || !role) {
    return (
      <ErrorState
        title="Роль не найдена"
        description="Проверьте адрес или вернитесь к списку ролей."
      />
    )
  }

  async function handleSave() {
    try {
      await save.mutateAsync(selected)
      await refreshUser()
      toast.success('Матрица прав сохранена')
      setDraft(null)
      setConfirmOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={role.name}
        description={role.description ?? 'Матрица прав этой роли.'}
        actions={
          canUpdate ? (
            <Button type="button" onClick={() => setConfirmOpen(true)} disabled={!isDirty || save.isPending}>
              Сохранить
            </Button>
          ) : null
        }
      />

      <PermissionMatrix selected={selected} onChange={setDraft} readOnly={!canUpdate} />

      <ConfirmDialog
        open={confirmOpen}
        title="Сохранить матрицу прав"
        description="Изменение прав сразу влияет на доступ сотрудников с этой ролью."
        confirmLabel="Сохранить"
        confirmVariant="default"
        isPending={save.isPending}
        onOpenChange={setConfirmOpen}
        onConfirm={() => void handleSave()}
      />
    </div>
  )
}
