import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { FilterBar } from '@/components/shared/FilterBar'
import { FolderTree, FolderTreeItemButton, nestByFolderKeys } from '@/components/shared/FolderTree'
import { ListPagination } from '@/components/shared/ListPagination'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageTabs } from '@/components/shared/PageTabs'
import { SearchInput } from '@/components/shared/SearchInput'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { SERIAL_LOOKUP_DEBOUNCE_MS } from '@/lib/constants/devices'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'
import { formatDate } from '@/lib/utils/date'

import { CreateDeviceDialog } from './CreateDeviceDialog'
import { DeviceDetailSheet } from './DeviceDetailScreen'
import { DeviceTypesBrowser } from './DeviceTypesBrowser'
import { WarrantyBadge } from './WarrantyBadge'
import { useDevices } from '../hooks/use-devices'
import type { Device } from '../services/devices-service'

type DevicesTab = 'registry' | 'types'

function parseTab(value: string | null): DevicesTab {
  return value === 'types' ? 'types' : 'registry'
}

export function DevicesScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [createOpen, setCreateOpen] = useState(false)
  const debouncedSearch = useDebouncedValue(search, SERIAL_LOOKUP_DEBOUNCE_MS)
  const canCreate = useHasPermission(Permission.DevicesCreate)
  const devicesQuery = useDevices(debouncedSearch, page, pageSize)
  const deviceId = searchParams.get('device')
  const tab = parseTab(searchParams.get('tab'))
  const devices = devicesQuery.data?.items ?? []
  const total = devicesQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const groups = useMemo(
    () =>
      nestByFolderKeys(devices, [
        (device) => ({
          id: `group:${device.groupId || device.groupName || 'none'}`,
          name: device.groupName.trim() || 'Без типа',
        }),
        (device) => ({
          id: `brand:${device.brandId || device.brandName || 'none'}`,
          name: device.brandName.trim() || 'Без бренда',
        }),
        (device) => ({
          id: `model:${device.modelId || device.modelName || 'none'}`,
          name: device.modelName.trim() || 'Без модели',
        }),
      ]),
    [devices],
  )

  function setTab(next: DevicesTab) {
    const params = new URLSearchParams(searchParams)
    if (next === 'registry') {
      params.delete('tab')
    } else {
      params.set('tab', next)
    }
    setSearchParams(params, { replace: true })
  }

  function openDevice(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('device', id)
    next.delete('edit')
    setSearchParams(next, { replace: true })
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
  }

  return (
    <div
      className={
        tab === 'types'
          ? 'flex h-[calc(100dvh-1.5rem)] min-h-0 flex-col gap-4 md:h-[calc(100dvh-2rem)]'
          : 'space-y-4'
      }
    >
      <PageHeader
        title="Приборы"
        description="Реестр эндоскопов и дерево видов: группы, бренды, модели и модификации."
      />

      <PageTabs
        aria-label="Разделы приборов"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'registry', label: 'Реестр' },
          { id: 'types', label: 'Виды' },
        ]}
      />

      {tab === 'types' ? (
        <div className="min-h-0 flex-1">
          <DeviceTypesBrowser />
        </div>
      ) : (
        <>
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

          {devicesQuery.isLoading ? (
            <LoadingState label="Загрузка приборов" className="min-h-40" />
          ) : devicesQuery.error ? (
            <ErrorState description={getErrorMessage(devicesQuery.error)} />
          ) : (
            <FolderTree
              groups={groups}
              getItemId={(device) => device.id}
              empty={
                <EmptyState
                  title="Приборы не найдены"
                  description="Измените запрос или добавьте прибор."
                  className="rounded-md border py-12"
                />
              }
              renderItem={(device: Device) => (
                <FolderTreeItemButton depth={3} onClick={() => openDevice(device.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{device.serialNumber}</span>
                  </span>
                  <span className="hidden shrink-0 sm:block">
                    <WarrantyBadge warranty={device.warranty} />
                  </span>
                  <span className="hidden w-[5.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground lg:block">
                    {formatDate(device.updatedAt)}
                  </span>
                </FolderTreeItemButton>
              )}
            />
          )}

          {pageCount > 1 || Boolean(pageSize) ? (
            <ListPagination
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null}
        </>
      )}

      <CreateDeviceDialog open={createOpen} onOpenChange={setCreateOpen} />
      <DeviceDetailSheet
        deviceId={deviceId}
        open={Boolean(deviceId)}
        onOpenChange={(open) => {
          if (!open) {
            const next = new URLSearchParams(searchParams)
            next.delete('device')
            next.delete('edit')
            setSearchParams(next, { replace: true })
          }
        }}
      />
    </div>
  )
}
