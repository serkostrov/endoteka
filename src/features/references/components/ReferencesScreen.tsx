import { Link } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { PageHeader } from '@/components/shared/PageHeader'
import { routes } from '@/lib/constants/routes'
import { ReferenceSetCode } from '@/lib/constants/references'
import { getErrorMessage } from '@/lib/errors'

import { useReferenceSets } from '../hooks/use-references'

export function ReferencesScreen() {
  const setsQuery = useReferenceSets()
  const sets = setsQuery.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Параметры"
        description="Настраиваемые словари сервисного центра. Состав значений меняется без правки программы."
      />
      <DataTable
        caption="Справочники"
        isLoading={setsQuery.isLoading}
        error={setsQuery.error ? getErrorMessage(setsQuery.error) : null}
        data={sets}
        getRowId={(row) => row.id}
        emptyTitle="Справочники не найдены"
        emptyDescription="Примените миграции базы данных, чтобы появились словари."
        columns={[
          {
            id: 'name',
            header: 'Справочник',
            cell: (row) => (
              <Link
                to={
                  row.code === ReferenceSetCode.OrderStatuses
                    ? routes.settingsOrderStatuses
                    : `${routes.settingsReferences}/${row.id}`
                }
                className="font-medium text-primary hover:underline"
              >
                {row.name}
              </Link>
            ),
          },
          {
            id: 'parent',
            header: 'Родитель',
            cell: (row) => row.parentSetName || '—',
          },
          {
            id: 'count',
            header: 'Записей',
            cell: (row) => `${row.activeItemCount} из ${row.itemCount}`,
          },
        ]}
      />
    </div>
  )
}
