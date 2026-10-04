import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { FolderBlock, FolderTreeItemButton } from '@/components/shared/FolderTree'
import { LoadingState } from '@/components/shared/LoadingState'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { WarrantyBadge } from './WarrantyBadge'
import {
  useDeviceRegistryBrands,
  useDeviceRegistryDevices,
  useDeviceRegistryGroups,
} from '../hooks/use-devices'
import type { Device } from '../services/devices-service'

type DeviceRegistryTreeProps = {
  search: string
  onOpenDevice: (id: string) => void
}

export function DeviceRegistryTree({ search, onOpenDevice }: DeviceRegistryTreeProps) {
  const groupsQuery = useDeviceRegistryGroups(search)
  const groups = groupsQuery.data ?? []
  const expandAll = Boolean(search.trim())
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setExpandedGroups({})
  }, [search])

  if (groupsQuery.isLoading) {
    return <LoadingState label="Загрузка приборов" className="min-h-40" />
  }
  if (groupsQuery.error) {
    return <ErrorState description={getErrorMessage(groupsQuery.error)} />
  }
  if (groups.length === 0) {
    return (
      <EmptyState
        title="Приборы не найдены"
        description="Измените запрос или добавьте прибор."
        className="rounded-md border py-12"
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-md border">
      {groups.map((group) => {
        const open =
          Object.prototype.hasOwnProperty.call(expandedGroups, group.key)
            ? Boolean(expandedGroups[group.key])
            : expandAll
        return (
          <FolderBlock
            key={group.key}
            title={group.name}
            count={group.count}
            open={open}
            depth={0}
            onToggle={() =>
              setExpandedGroups((current) => ({
                ...current,
                [group.key]: !open,
              }))
            }
          >
            {open ? (
              <BrandFolderList
                search={search}
                groupKey={group.key}
                expandAll={expandAll}
                onOpenDevice={onOpenDevice}
              />
            ) : null}
          </FolderBlock>
        )
      })}
    </div>
  )
}

function BrandFolderList({
  search,
  groupKey,
  expandAll,
  onOpenDevice,
}: {
  search: string
  groupKey: string
  expandAll: boolean
  onOpenDevice: (id: string) => void
}) {
  const brandsQuery = useDeviceRegistryBrands(search, groupKey)
  const brands = brandsQuery.data ?? []
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setExpandedBrands({})
  }, [search, groupKey])

  if (brandsQuery.isLoading) {
    return <LoadingState label="Загрузка брендов" className="min-h-16 py-4" />
  }
  if (brandsQuery.error) {
    return (
      <p className="px-3 py-3 text-sm text-destructive">{getErrorMessage(brandsQuery.error)}</p>
    )
  }
  if (brands.length === 0) {
    return <p className="px-3 py-3 text-sm text-muted-foreground">В группе нет приборов</p>
  }

  return (
    <>
      {brands.map((brand) => {
        const open =
          Object.prototype.hasOwnProperty.call(expandedBrands, brand.key)
            ? Boolean(expandedBrands[brand.key])
            : expandAll
        return (
          <FolderBlock
            key={brand.key}
            title={brand.name}
            count={brand.count}
            open={open}
            depth={1}
            onToggle={() =>
              setExpandedBrands((current) => ({
                ...current,
                [brand.key]: !open,
              }))
            }
          >
            {open ? (
              <DeviceLeafList
                search={search}
                groupKey={groupKey}
                brandKey={brand.key}
                onOpenDevice={onOpenDevice}
              />
            ) : null}
          </FolderBlock>
        )
      })}
    </>
  )
}

function DeviceLeafList({
  search,
  groupKey,
  brandKey,
  onOpenDevice,
}: {
  search: string
  groupKey: string
  brandKey: string
  onOpenDevice: (id: string) => void
}) {
  const devicesQuery = useDeviceRegistryDevices(search, groupKey, brandKey)
  const devices = devicesQuery.data ?? []

  if (devicesQuery.isLoading) {
    return <LoadingState label="Загрузка приборов" className="min-h-16 py-4" />
  }
  if (devicesQuery.error) {
    return (
      <p className="px-3 py-3 text-sm text-destructive">{getErrorMessage(devicesQuery.error)}</p>
    )
  }
  if (devices.length === 0) {
    return <p className="px-3 py-3 text-sm text-muted-foreground">Приборов нет</p>
  }

  return (
    <ul>
      {devices.map((device) => (
        <li key={device.id}>
          <DeviceRow device={device} onOpen={() => onOpenDevice(device.id)} />
        </li>
      ))}
    </ul>
  )
}

function DeviceRow({ device, onOpen }: { device: Device; onOpen: () => void }) {
  const serial = device.serialNumber.trim().toLocaleLowerCase('ru')
  const subtitle = [device.modelName, device.modificationName]
    .map((value) => value.trim())
    .filter((value) => value && !serial.includes(value.toLocaleLowerCase('ru')))
    .join(' ')

  return (
    <FolderTreeItemButton depth={2} onClick={onOpen}>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">
          {device.serialNumber.trim() || 'Без серийного номера'}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      <span className={cn('hidden shrink-0 sm:block')}>
        <WarrantyBadge warranty={device.warranty} />
      </span>
      <span className="hidden w-[5.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground lg:block">
        {formatDate(device.updatedAt)}
      </span>
    </FolderTreeItemButton>
  )
}
