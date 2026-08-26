import { Plus } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { SearchInput } from '@/components/shared/SearchInput'
import { SearchSuggestOverlay } from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { classificationLabel } from '../classification'
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
  createLabel = 'Новый прибор',
}: SerialNumberLookupProps) {
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const matched = result.data?.kind === 'exact' ? result.data.device : null
  const items = result.data?.kind === 'list' ? result.data.items : []
  const searching = (result.isFetching || isDebouncing) && !matched
  const showPanel = open && !matched

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      {matched ? (
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
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
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
                    <p className="px-3 py-4 text-sm text-muted-foreground">Приборы не найдены</p>
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
                onFocus={() => setOpen(true)}
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
          </div>
          {allowCreate ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0"
              disabled={disabled}
              aria-label={createLabel}
              onClick={() => onCreateRequest?.(value.trim())}
            >
              <Plus className="size-4" />
              Новый
            </Button>
          ) : null}
        </div>
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
        'flex flex-1 flex-col space-y-3 rounded-md border bg-card px-3 py-3 text-left',
        clickable && 'cursor-pointer transition-colors hover:bg-muted/40',
      )}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Открыть прибор ${device.serialNumber}` : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={onCardKeyDown}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">СН {device.serialNumber}</p>
          <p className="truncate text-xs text-muted-foreground">{classificationLabel(device)}</p>
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

      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Гарантия</p>
          <div className="mt-1">
            <WarrantyBadge warranty={device.warranty} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Последний заказ</p>
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
        </div>
      </div>

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
        <span className="font-medium">{item.serialNumber}</span>
        <span className="text-xs text-muted-foreground">
          {[item.label, item.groupName].filter(Boolean).join(' · ') || 'Прибор'}
        </span>
      </button>
    </li>
  )
}
