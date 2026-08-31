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
import { DEVICE_PAGE_SIZE, SERIAL_LOOKUP_DEBOUNCE_MS } from '@/lib/constants/devices'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { formatDate } from '@/lib/utils/date'

import { deviceSerialLine, deviceTitle } from '../classification'
import { CreateDeviceDialog } from './CreateDeviceDialog'
import { EditDeviceDialog } from './EditDeviceDialog'
import { WarrantyBadge } from './WarrantyBadge'
import { useDeleteDevice, useDevices } from '../hooks/use-devices'
import type { Device } from '../services/devices-service'

export function DevicesScreen() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Device | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null)
  const debouncedSearch = useDebouncedValue(search, SERIAL_LOOKUP_DEBOUNCE_MS)
  const canCreate = useHasPermission(Permission.DevicesCreate)
  const canUpdate = useHasPermission(Permission.DevicesUpdate)
  const canDelete = useHasPermission(Permission.DevicesDelete)
  const devicesQuery = useDevices(debouncedSearch, page, DEVICE_PAGE_SIZE)
  const remove = useDeleteDevice()
  const navigate = useNavigate()
  const total = devicesQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / DEVICE_PAGE_SIZE))

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Прибор удалён')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Приборы"
        description="Карточки эндоскопов: тип, производитель и модель. История ремонтов не зависит от текущего клиента."
      />

      <FilterBar
        end={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый прибор
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
          label="Поиск приборов"
          placeholder="Серийный номер, бренд или модель"
        />
      </FilterBar>

      <DataTable
        caption="Приборы"
        isLoading={devicesQuery.isLoading}
        error={devicesQuery.error ? getErrorMessage(devicesQuery.error) : null}
        data={devicesQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Приборы не найдены"
        emptyDescription="Измените запрос или добавьте прибор."
        onRowClick={(row) => navigate(routes.device.replace(':id', row.id))}
        pagination={{ page, pageCount, onPageChange: setPage }}
        columns={[
          { id: 'device', header: 'Прибор', cell: (row) => deviceTitle(row) },
          { id: 'serial', header: 'Серийный номер', cell: (row) => row.serialNumber },
          {
            id: 'warranty',
            header: 'Гарантия',
            cell: (row) => <WarrantyBadge warranty={row.warranty} />,
          },
          {
            id: 'updated',
            header: 'Обновлён',
            className: 'hidden lg:table-cell',
            cell: (row) => formatDate(row.updatedAt),
          },
          ...(canUpdate || canDelete
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: Device) => (
                    <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                      {canUpdate ? (
                        <IconActionButton label="Изменить" onClick={() => setEditTarget(row)}>
                          <Pencil />
                        </IconActionButton>
                      ) : null}
                      {canDelete ? (
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

      <CreateDeviceDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditDeviceDialog
        device={editTarget}
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null)
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить прибор"
        description={
          deleteTarget
            ? `${deviceTitle(deleteTarget)}. ${deviceSerialLine(deleteTarget.serialNumber)} будет удалён. Если по нему есть заказы, удаление не пройдёт.`
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
