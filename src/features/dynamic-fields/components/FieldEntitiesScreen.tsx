import { Link } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { PageHeader } from '@/components/shared/PageHeader'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'

import { useFieldEntities } from '../hooks/use-fields'

export function FieldEntitiesScreen() {
  const entitiesQuery = useFieldEntities()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Поля карточек"
        description="Дополнительные поля по разделам. Определения хранятся отдельно от значений записей."
      />
      <DataTable
        caption="Разделы"
        isLoading={entitiesQuery.isLoading}
        error={entitiesQuery.error ? getErrorMessage(entitiesQuery.error) : null}
        data={entitiesQuery.data ?? []}
        getRowId={(row) => row.code}
        emptyTitle="Разделы не найдены"
        emptyDescription="Примените миграции базы данных, чтобы появились разделы полей."
        columns={[
          {
            id: 'name',
            header: 'Раздел',
            cell: (row) => (
              <Link
                to={`${routes.settingsFields}/${row.code}`}
                className="font-medium text-primary hover:underline"
              >
                {row.name}
              </Link>
            ),
          },
          {
            id: 'count',
            header: 'Полей',
            cell: (row) => `${row.activeFieldCount} из ${row.fieldCount}`,
          },
          {
            id: 'description',
            header: 'Описание',
            cell: (row) => row.description || '—',
          },
        ]}
      />
    </div>
  )
}
