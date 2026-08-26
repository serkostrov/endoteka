import { Link } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { PageHeader } from '@/components/shared/PageHeader'
import { getErrorMessage } from '@/lib/errors'
import { routes } from '@/lib/constants/routes'

import { useRoles } from '../hooks/use-roles'

export function RolesScreen() {
  const rolesQuery = useRoles()

  return (
    <div className="space-y-4">
      <PageHeader title="Роли и права" description="Матрица доступа по ролям сервисного центра." />
      <DataTable
        caption="Роли"
        isLoading={rolesQuery.isLoading}
        error={rolesQuery.error ? getErrorMessage(rolesQuery.error) : null}
        data={rolesQuery.data ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Роли не найдены"
        emptyDescription="Роли появятся после применения миграций базы данных."
        columns={[
          {
            id: 'name',
            header: 'Роль',
            cell: (row) => (
              <Link to={`${routes.roles}/${row.id}`} className="font-medium text-primary hover:underline">
                {row.name}
              </Link>
            ),
          },
          { id: 'description', header: 'Описание', cell: (row) => row.description || '—' },
        ]}
      />
    </div>
  )
}
