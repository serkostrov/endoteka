import { Link } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { PageHeader } from '@/components/shared/PageHeader'
import { useServiceTemplates } from '@/features/services/hooks/use-services'
import { routes } from '@/lib/constants/routes'
import { ReferenceSetCode } from '@/lib/constants/references'
import { getErrorMessage } from '@/lib/errors'

import { useReferenceSets } from '../hooks/use-references'

type ParameterRow = {
  id: string
  name: string
  parent: string
  count: string
  to: string
}

export function ReferencesScreen() {
  const setsQuery = useReferenceSets()
  const templatesQuery = useServiceTemplates('', 1, 1)
  const sets = setsQuery.data ?? []
  const dictionaryRows: ParameterRow[] = sets.map((row) => ({
    id: row.id,
    name: row.name,
    parent: row.parentSetName || '—',
    count: `${row.activeItemCount} из ${row.itemCount}`,
    to:
      row.code === ReferenceSetCode.OrderStatuses
        ? routes.settingsOrderStatuses
        : `${routes.settingsReferences}/${row.id}`,
  }))
  const serviceTemplatesRow: ParameterRow = {
    id: 'service-templates',
    name: 'Шаблоны услуг',
    parent: '—',
    count: templatesQuery.data ? String(templatesQuery.data.total) : '—',
    to: routes.settingsServiceTemplates,
  }
  const insertAfter = sets.findIndex((row) => row.code === ReferenceSetCode.DeviceModifications)
  const rows =
    insertAfter >= 0
      ? [
          ...dictionaryRows.slice(0, insertAfter + 1),
          serviceTemplatesRow,
          ...dictionaryRows.slice(insertAfter + 1),
        ]
      : [...dictionaryRows, serviceTemplatesRow]

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
        data={rows}
        getRowId={(row) => row.id}
        emptyTitle="Справочники не найдены"
        emptyDescription="Примените миграции базы данных, чтобы появились словари."
        columns={[
          {
            id: 'name',
            header: 'Справочник',
            cell: (row) => (
              <Link to={row.to} className="font-medium text-primary hover:underline">
                {row.name}
              </Link>
            ),
          },
          {
            id: 'parent',
            header: 'Родитель',
            cell: (row) => row.parent,
          },
          {
            id: 'count',
            header: 'Записей',
            cell: (row) => row.count,
          },
        ]}
      />
    </div>
  )
}
