import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { FolderTree, FolderTreeItemButton, nestByFolderKeys } from '@/components/shared/FolderTree'
import { SearchInput } from '@/components/shared/SearchInput'
import {
  SearchCreateAction,
  SearchEmptyCreate,
  SearchSuggestOverlay,
  SearchSuggestPanel,
} from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { DeviceDetailSheet } from './DeviceDetailScreen'
import { deviceSerialLine, deviceTitle } from '../classification'
import type { DeviceLookup, DeviceSearchItem, SerialSearchResult } from '../services/devices-service'

type SerialNumberLookupProps = {
  value: string
  onChange: (value: string) => void
  result: UseQueryResult<SerialSearchResult>
  /** Уже выбранный прибор — карточка показывается только после явного выбора. */
  selectedId?: string | null
  disabled?: boolean
  isDebouncing?: boolean
  allowCreate?: boolean
  onCreateRequest?: (serial: string) => void
  onSelectItem?: (item: DeviceSearchItem) => void
  onClear?: () => void
  createLabel?: string
  framed?: boolean
  label?: string
  /** Скрыть кнопку «Сменить» внутри (если она в заголовке снаружи). */
  hideChangeButton?: boolean
}

function toSearchItem(device: DeviceLookup): DeviceSearchItem {
  return {
    id: device.id,
    serialNumber: device.serialNumber,
    label: deviceTitle(device),
    groupName: device.groupName,
    brandName: device.brandName,
    modelName: device.modelName,
  }
}

export function SerialNumberLookup({
  value,
  onChange,
  result,
  selectedId = null,
  disabled = false,
  isDebouncing = false,
  allowCreate = false,
  onCreateRequest,
  onSelectItem,
  onClear,
  createLabel = 'Новый',
  framed = false,
  label,
  hideChangeButton = false,
}: SerialNumberLookupProps) {
  const [open, setOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [locked, setLocked] = useState<DeviceSearchItem | DeviceLookup | null>(null)

  const exactDevice = result.data?.kind === 'exact' ? result.data.device : null
  const listItems = result.data?.kind === 'list' ? result.data.items : []
  const panelItems = useMemo(() => {
    if (exactDevice) {
      return [toSearchItem(exactDevice)]
    }
    return listItems
  }, [exactDevice, listItems])

  useEffect(() => {
    if (!selectedId) {
      setLocked(null)
      return
    }
    if (exactDevice?.id === selectedId) {
      setLocked(exactDevice)
    }
  }, [exactDevice, selectedId])

  const selected =
    locked && selectedId && locked.id === selectedId
      ? locked
      : selectedId && exactDevice && exactDevice.id === selectedId
        ? exactDevice
        : null
  const searching = (result.isFetching || isDebouncing) && !selected
  const showPanel = open && !selected

  useEffect(() => {
    if (selected) {
      setOpen(false)
    }
  }, [selected])

  const groups = useMemo(
    () =>
      nestByFolderKeys(panelItems, [
        (device) => ({
          id: `group:${device.groupName || 'none'}`,
          name: device.groupName.trim() || 'Без типа',
        }),
        (device) => ({
          id: `brand:${device.brandName || 'none'}`,
          name: device.brandName.trim() || 'Без бренда',
        }),
        (device) => ({
          id: `model:${device.modelName || 'none'}`,
          name: device.modelName.trim() || 'Без модели',
        }),
      ]),
    [panelItems],
  )

  function clearDevice() {
    setOpen(false)
    setDetailOpen(false)
    setLocked(null)
    if (onClear) {
      onClear()
      return
    }
    onChange('')
  }

  function selectItem(item: DeviceSearchItem) {
    setLocked(exactDevice?.id === item.id ? exactDevice : item)
    if (onSelectItem) {
      onSelectItem(item)
    } else {
      onChange(item.serialNumber)
    }
    setOpen(false)
  }

  function requestCreate() {
    setOpen(false)
    onCreateRequest?.(value.trim())
  }

  const changeButton =
    selected && !disabled && !hideChangeButton ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto shrink-0 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={clearDevice}
      >
        Сменить
      </Button>
    ) : null

  const body = selected ? (
    <DeviceLookupCard device={selected} disabled={disabled} onOpen={() => setDetailOpen(true)} />
  ) : (
    <SearchSuggestOverlay
      open={showPanel}
      onOpenChange={setOpen}
      panel={
        <SearchSuggestPanel
          footer={
            allowCreate && panelItems.length > 0 ? (
              <SearchCreateAction
                label={createLabel}
                disabled={disabled}
                size="comfortable"
                onCreate={requestCreate}
              />
            ) : null
          }
        >
          {result.error ? (
            <p className="px-3 py-4 text-sm text-destructive">{getErrorMessage(result.error)}</p>
          ) : searching && panelItems.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Поиск…</p>
          ) : panelItems.length === 0 ? (
            <SearchEmptyCreate
              message="Приборы не найдены"
              actionLabel={createLabel}
              disabled={disabled}
              actionSize="comfortable"
              onCreate={allowCreate ? requestCreate : undefined}
            />
          ) : (
            <FolderTree
              groups={groups}
              getItemId={(device) => device.id}
              className="rounded-none border-0"
              renderItem={(device) => (
                <FolderTreeItemButton
                  depth={3}
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectItem(device)}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{device.serialNumber}</span>
                  <span className="text-muted-foreground truncate text-xs">{device.label}</span>
                </FolderTreeItemButton>
              )}
            />
          )}
        </SearchSuggestPanel>
      }
    >
      <SearchInput
        value={value}
        onChange={(next) => {
          onChange(next)
          setOpen(true)
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
          }
          if (event.key === 'Enter' && exactDevice) {
            event.preventDefault()
            selectItem(toSearchItem(exactDevice))
          }
        }}
        disabled={disabled}
        label="Серийный номер"
        placeholder="Серийный номер"
        className="max-w-none"
      />
    </SearchSuggestOverlay>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {framed ? (
        <section className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border bg-background p-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            {label ? (
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
            ) : (
              <span />
            )}
            {changeButton}
          </div>
          {body}
        </section>
      ) : (
        <>
          {changeButton ? <div className="mb-1.5 flex justify-end">{changeButton}</div> : null}
          {body}
        </>
      )}
      <DeviceDetailSheet
        deviceId={selected?.id ?? null}
        open={detailOpen && Boolean(selected)}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

export function DeviceLookupCard({
  device,
  onOpen,
  disabled,
}: {
  device: Pick<DeviceLookup, 'id' | 'serialNumber' | 'groupName' | 'brandName' | 'modelName'> & {
    label?: string
  }
  onOpen?: () => void
  disabled?: boolean
}) {
  const clickable = Boolean(onOpen) && !disabled
  const title = 'label' in device && device.label ? device.label : deviceTitle(device)
  const ariaLabel = `Открыть карточку ${title}`

  function onCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!clickable || !onOpen) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }

  return (
    <div
      className={cn(
        'text-left',
        clickable && 'cursor-pointer rounded-md transition-colors hover:bg-muted/50',
      )}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? ariaLabel : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={onCardKeyDown}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {device.serialNumber ? (
          <p className="truncate text-xs text-muted-foreground">{deviceSerialLine(device.serialNumber)}</p>
        ) : null}
      </div>
    </div>
  )
}
