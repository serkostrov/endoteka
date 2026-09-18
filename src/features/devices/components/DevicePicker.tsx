import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'

import { CreateDeviceDialog } from './CreateDeviceDialog'
import { SerialNumberLookup } from './SerialNumberLookup'
import type { Device, DeviceSearchItem, SerialSearchResult } from '../services/devices-service'

type DevicePickerProps = {
  serial: string
  onSerialChange: (serial: string) => void
  result: UseQueryResult<SerialSearchResult>
  /** Подтверждённый выбор — без него точное совпадение не подставляется само. */
  selectedId?: string | null
  disabled?: boolean
  customerId?: string
  isDebouncing?: boolean
  onCreated?: (device: Device) => void
  onSelectDevice?: (item: DeviceSearchItem) => void
  onClear?: () => void
  framed?: boolean
  label?: string
  hideChangeButton?: boolean
}

export function DevicePicker({
  serial,
  onSerialChange,
  result,
  selectedId = null,
  disabled = false,
  customerId,
  isDebouncing = false,
  onCreated,
  onSelectDevice,
  onClear,
  framed = false,
  label,
  hideChangeButton = false,
}: DevicePickerProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const canCreate = useHasPermission(Permission.DevicesCreate)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SerialNumberLookup
        value={serial}
        onChange={onSerialChange}
        result={result}
        selectedId={selectedId}
        disabled={disabled}
        isDebouncing={isDebouncing}
        allowCreate={canCreate}
        onCreateRequest={() => setCreateOpen(true)}
        onSelectItem={(item) => {
          onSerialChange(item.serialNumber)
          onSelectDevice?.(item)
        }}
        onClear={onClear}
        framed={framed}
        label={label}
        hideChangeButton={hideChangeButton}
      />
      <CreateDeviceDialog
        key={createOpen ? `open-${serial}` : 'closed'}
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultSerial={serial}
        defaultCustomerId={customerId}
        onCreated={(device) => {
          if (onCreated) {
            onCreated(device)
            return
          }
          onSerialChange(device.serialNumber)
        }}
      />
    </div>
  )
}
