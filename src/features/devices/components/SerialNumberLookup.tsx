import { type KeyboardEvent, useMemo, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { FolderTree, FolderTreeItemButton, nestByFolderKeys } from '@/components/shared/FolderTree'
import { SearchInput } from '@/components/shared/SearchInput'
import {
  SearchCreateAction,
  SearchEmptyCreate,
  SearchSuggestOverlay,
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
  disabled?: boolean
  isDebouncing?: boolean
  allowCreate?: boolean
  onCreateRequest?: (serial: string) => void
  onSelectItem?: (item: DeviceSearchItem) => void
  createLabel?: string
  framed?: boolean
  label?: string
}

export function SerialNumberLookup({
  value,
  onChange,
  result,
  disabled = false,
  isDebouncing = false,
  allowCreate = false,
  onCreateRequest,
  onSelectItem,
  createLabel = 'Новый',
  framed = false,
  label,
}: SerialNumberLookupProps) {
  const [open, setOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const matched = result.data?.kind === 'exact' ? result.data.device : null
  const items = result.data?.kind === 'list' ? result.data.items : []
  const searching = (result.isFetching || isDebouncing) && !matched
  const showPanel = open && !matched

  const groups = useMemo(
    () =>
      nestByFolderKeys(items, [
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
    [items],
  )

  function clearDevice() {
    setOpen(false)
    setDetailOpen(false)
    onChange('')
  }

  function selectItem(item: DeviceSearchItem) {
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

  const body = matched ? (
    <DeviceLookupCard
      device={matched}
      disabled={disabled}
      onOpen={() => setDetailOpen(true)}
      onClear={framed ? undefined : clearDevice}
    />
  ) : (
    <SearchSuggestOverlay
      open={showPanel}
      onOpenChange={setOpen}
      panel={
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 max-h-72 overflow-auto">
            {result.error ? (
              <p className="px-3 py-4 text-sm text-destructive">{getErrorMessage(result.error)}</p>
            ) : searching && items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">Поиск…</p>
            ) : items.length === 0 ? (
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
                  </FolderTreeItemButton>
                )}
              />
            )}
          </div>
          {allowCreate && items.length > 0 ? (
            <SearchCreateAction
              label={createLabel}
              disabled={disabled}
              size="comfortable"
              onCreate={requestCreate}
            />
          ) : null}
        </div>
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
            {matched && !disabled ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto shrink-0 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearDevice}
              >
                Сменить
              </Button>
            ) : null}
          </div>
          {body}
        </section>
      ) : (
        body
      )}
      <DeviceDetailSheet
        deviceId={matched?.id ?? null}
        open={detailOpen && Boolean(matched)}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

export function DeviceLookupCard({
  device,
  onClear,
  onOpen,
  disabled,
}: {
  device: DeviceLookup
  onClear?: () => void
  onOpen?: () => void
  disabled?: boolean
}) {
  const action = onClear ?? onOpen
  const clickable = Boolean(action) && !disabled
  const ariaLabel = onClear
    ? `Сменить прибор ${deviceTitle(device)}`
    : `Открыть карточку ${deviceTitle(device)}`

  function onCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!clickable || !action) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
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
      onClick={clickable ? action : undefined}
      onKeyDown={onCardKeyDown}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{deviceTitle(device)}</p>
        {device.serialNumber ? (
          <p className="truncate text-xs text-muted-foreground">{deviceSerialLine(device.serialNumber)}</p>
        ) : null}
      </div>
    </div>
  )
}
