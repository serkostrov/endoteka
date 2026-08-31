import { type KeyboardEvent, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { SearchInput } from '@/components/shared/SearchInput'
import { SearchEmptyCreate, SearchSuggestOverlay } from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { deviceSerialLine, deviceTitle } from '../classification'
import { EditDeviceDialog } from './EditDeviceDialog'
import { WarrantyBadge } from './WarrantyBadge'
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
  const [editOpen, setEditOpen] = useState(false)
  const matched = result.data?.kind === 'exact' ? result.data.device : null
  const items = result.data?.kind === 'list' ? result.data.items : []
  const searching = (result.isFetching || isDebouncing) && !matched
  const showPanel = open && !matched

  const body = matched ? (
    <DeviceLookupCard
      device={matched}
      disabled={disabled}
      onClear={() => {
        setEditOpen(false)
        setOpen(false)
        onChange('')
      }}
      onOpen={() => setEditOpen(true)}
    />
  ) : (
    <SearchSuggestOverlay
      open={showPanel}
      onOpenChange={setOpen}
      panel={
        <div className="max-h-64 overflow-auto">
          {result.error ? (
            <p className="px-3 py-4 text-sm text-destructive">{getErrorMessage(result.error)}</p>
          ) : searching && items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Поиск…</p>
          ) : items.length === 0 ? (
            <SearchEmptyCreate
              message="Приборы не найдены"
              actionLabel={createLabel}
              disabled={disabled}
              onCreate={
                allowCreate
                  ? () => {
                      setOpen(false)
                      onCreateRequest?.(value.trim())
                    }
                  : undefined
              }
            />
          ) : (
            <ul>
              {items.map((item) => (
                <SerialResultItem
                  key={item.id}
                  item={item}
                  disabled={disabled}
                  onSelect={() => {
                    if (onSelectItem) {
                      onSelectItem(item)
                    } else {
                      onChange(item.serialNumber)
                    }
                    setOpen(false)
                  }}
                />
              ))}
            </ul>
          )}
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
        <section className="rounded-xl border bg-card p-4">
          {label ? (
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          ) : null}
          {body}
        </section>
      ) : (
        body
      )}
      <EditDeviceDialog
        device={matched}
        open={editOpen && Boolean(matched)}
        onOpenChange={setEditOpen}
      />
    </div>
  )
}

export function DeviceLookupCard({
  device,
  onClear,
  onOpen,
  disabled,
  showClear = true,
}: {
  device: DeviceLookup
  onClear?: () => void
  onOpen?: () => void
  disabled?: boolean
  showClear?: boolean
}) {
  const latest = device.latestOrder
  const repairs = device.repairs.slice(0, 3)
  const clickable = Boolean(onOpen) && !disabled

  function onCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!clickable) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen?.()
    }
  }

  return (
    <div
      className={cn(
        'space-y-3 text-left',
        clickable && 'cursor-pointer rounded-md transition-colors hover:bg-muted/40',
      )}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Открыть прибор ${deviceTitle(device)}` : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={onCardKeyDown}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{deviceTitle(device)}</p>
          {device.serialNumber ? (
            <p className="truncate text-xs text-muted-foreground">{deviceSerialLine(device.serialNumber)}</p>
          ) : null}
        </div>
        {showClear && onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation()
              onClear()
            }}
          >
            Сменить
          </Button>
        ) : null}
      </div>

      <dl className="space-y-2 text-sm">
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Гарантия</dt>
          <dd>
            <WarrantyBadge warranty={device.warranty} />
          </dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Последний заказ</dt>
          <dd>
            {latest ? (
              <p>
                {latest.number} · {latest.statusName}
                <span className="block text-xs text-muted-foreground">
                  {latest.customerName} · {formatDate(latest.createdAt)}
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground">Ремонтов ещё не было</p>
            )}
          </dd>
        </div>
      </dl>

      {repairs.length > 0 ? (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Предыдущие ремонты</p>
          <ul className="space-y-1 text-sm">
            {repairs.map((repair) => (
              <li key={repair.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {repair.number} · {repair.customerName}
                </span>
                <span className="shrink-0 text-muted-foreground">{repair.statusName}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function SerialResultItem({
  item,
  disabled,
  onSelect,
}: {
  item: DeviceSearchItem
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        className={cn('flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSelect}
      >
        <span className="font-medium">{deviceTitle(item)}</span>
        <span className="text-xs text-muted-foreground">
          {deviceSerialLine(item.serialNumber) || item.groupName || 'Прибор'}
        </span>
      </button>
    </li>
  )
}
