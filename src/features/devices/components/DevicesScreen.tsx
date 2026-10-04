import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { FilterBar } from '@/components/shared/FilterBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageTabs } from '@/components/shared/PageTabs'
import { SearchInput } from '@/components/shared/SearchInput'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { SERIAL_LOOKUP_DEBOUNCE_MS } from '@/lib/constants/devices'
import { Permission } from '@/lib/constants/permissions'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { CreateDeviceDialog } from './CreateDeviceDialog'
import { DeviceDetailSheet } from './DeviceDetailScreen'
import { DeviceRegistryTree } from './DeviceRegistryTree'
import { DeviceTypesBrowser } from './DeviceTypesBrowser'

type DevicesTab = 'registry' | 'types'

function parseTab(value: string | null): DevicesTab {
  return value === 'registry' ? 'registry' : 'types'
}

export function DevicesScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const debouncedSearch = useDebouncedValue(search, SERIAL_LOOKUP_DEBOUNCE_MS)
  const canCreate = useHasPermission(Permission.DevicesCreate)
  const deviceId = searchParams.get('device')
  const tab = parseTab(searchParams.get('tab'))

  function setTab(next: DevicesTab) {
    const params = new URLSearchParams(searchParams)
    if (next === 'types') {
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
        description="Реестр приборов и дерево видов: группы, бренды и модели."
      />

      <PageTabs
        aria-label="Разделы приборов"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'types', label: 'Виды' },
          { id: 'registry', label: 'Реестр' },
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
              onChange={setSearch}
              label="Поиск приборов"
              placeholder="Серийный номер, бренд или модель"
            />
          </FilterBar>

          <DeviceRegistryTree search={debouncedSearch} onOpenDevice={openDevice} />
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
