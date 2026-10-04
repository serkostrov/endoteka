import { Link } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { PageHeader } from '@/components/shared/PageHeader'
import { useDeviceCompatiblePartGroups } from '@/features/devices/hooks/use-compatible-parts'
import { useServiceTemplates } from '@/features/services/hooks/use-services'
import { routes } from '@/lib/constants/routes'
import { ReferenceSetCode } from '@/lib/constants/references'
import { getErrorMessage } from '@/lib/errors'

import { useReferenceSets } from '../hooks/use-references'

const DEVICE_TYPE_CODES = new Set<string>([
  ReferenceSetCode.DeviceGroups,
  ReferenceSetCode.DeviceBrands,
  ReferenceSetCode.DeviceModels,
  ReferenceSetCode.DeviceModifications,
])

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
  const partGroupsQuery = useDeviceCompatiblePartGroups()
  const sets = setsQuery.data ?? []

  const dictionaryRows: ParameterRow[] = sets
    .filter((row) => !DEVICE_TYPE_CODES.has(row.code))
    .map((row) => ({
      id: row.id,
      name: row.name,
      parent: row.parentSetName || '—',
      count: `${row.activeItemCount} из ${row.itemCount}`,
      to:
        row.code === ReferenceSetCode.OrderStatuses
          ? routes.settingsOrderStatuses
          : `${routes.settingsReferences}/${row.id}`,
    }))

  const rows: ParameterRow[] = [
    ...dictionaryRows,
    {
      id: 'compatible-part-groups',
      name: 'Группы запасных частей',
      parent: '—',
      count: partGroupsQuery.data ? String(partGroupsQuery.data.length) : '—',
      to: routes.settingsCompatiblePartGroups,
    },
    {
      id: 'service-templates',
      name: 'Шаблоны услуг',
      parent: '—',
      count: templatesQuery.data ? String(templatesQuery.data.total) : '—',
      to: routes.settingsServiceTemplates,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Параметры"
        description="Общие словари статусов, брендов, моделей и других значений."
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
