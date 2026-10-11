import { useState } from 'react'
import { CalendarDays, ChevronDownIcon } from 'lucide-react'

import { DatePicker } from '@/components/shared/DatePicker'
import { FilterClearButton } from '@/components/shared/FilterClearButton'
import { activeFilterControlClass } from '@/components/shared/active-filter-style'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DatePeriodPreset,
  datePeriodPastPresets,
  datePeriodPresetLabels,
  datePeriodPrimaryPresets,
  formatDatePeriodTriggerLabel,
  normalizeCustomDateOrder,
  type DatePeriodPreset as DatePeriodPresetType,
} from '@/lib/constants/date-period'
import { cn } from '@/lib/utils'

export type CreatedPeriodFilterValue = {
  preset: DatePeriodPresetType
  from: string | null
  to: string | null
}

type CreatedPeriodFilterProps = {
  value: CreatedPeriodFilterValue
  onChange: (next: CreatedPeriodFilterValue) => void
  prefix?: string
  className?: string
  'aria-label'?: string
}

function PeriodOption({
  label,
  active,
  onSelect,
}: {
  label: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent',
        active && 'bg-accent',
      )}
      onClick={onSelect}
    >
      {label}
    </button>
  )
}

export function CreatedPeriodFilter({
  value,
  onChange,
  prefix = 'Создано',
  className,
  'aria-label': ariaLabel = 'Фильтр по дате создания',
}: CreatedPeriodFilterProps) {
  const [open, setOpen] = useState(false)
  const isActive = value.preset !== DatePeriodPreset.All
  const showCustom = value.preset === DatePeriodPreset.Custom

  function selectPreset(preset: DatePeriodPresetType) {
    if (preset === DatePeriodPreset.Custom) {
      onChange({ preset, from: value.from, to: value.to })
      return
    }
    onChange({ preset, from: null, to: null })
    setOpen(false)
  }

  function setCustomFrom(next: string) {
    const from = next || null
    const to = value.to
    if (from && to) {
      const ordered = normalizeCustomDateOrder(from, to)
      onChange({ preset: DatePeriodPreset.Custom, from: ordered.from, to: ordered.to })
      return
    }
    onChange({ preset: DatePeriodPreset.Custom, from, to })
  }

  function setCustomTo(next: string) {
    const to = next || null
    const from = value.from
    if (from && to) {
      const ordered = normalizeCustomDateOrder(from, to)
      onChange({ preset: DatePeriodPreset.Custom, from: ordered.from, to: ordered.to })
      return
    }
    onChange({ preset: DatePeriodPreset.Custom, from, to })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="select-trigger"
          aria-label={ariaLabel}
          className={activeFilterControlClass(
            isActive,
            cn(
              "flex h-9 w-auto min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-muted px-3 py-0 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
              className,
            ),
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CalendarDays className="size-4 shrink-0 opacity-70" />
            <span className="truncate">
              {formatDatePeriodTriggerLabel(prefix, value.preset, value.from, value.to)}
            </span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {isActive ? (
              <FilterClearButton
                onClear={() => onChange({ preset: DatePeriodPreset.All, from: null, to: null })}
                label="Сбросить фильтр по дате"
              />
            ) : null}
            <ChevronDownIcon className="opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="p-0.5">
          {datePeriodPrimaryPresets.map((preset) => (
            <PeriodOption
              key={preset}
              label={datePeriodPresetLabels[preset]}
              active={value.preset === preset}
              onSelect={() => selectPreset(preset)}
            />
          ))}
        </div>
        <div className="my-1 border-t" />
        <div className="p-0.5">
          {datePeriodPastPresets.map((preset) => (
            <PeriodOption
              key={preset}
              label={datePeriodPresetLabels[preset]}
              active={value.preset === preset}
              onSelect={() => selectPreset(preset)}
            />
          ))}
        </div>
        <div className="my-1 border-t" />
        <div className="p-0.5">
          <PeriodOption
            label={datePeriodPresetLabels.custom}
            active={showCustom}
            onSelect={() => selectPreset(DatePeriodPreset.Custom)}
          />
        </div>
        {showCustom ? (
          <div className="space-y-2 border-t p-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">С</p>
              <DatePicker
                value={value.from ?? ''}
                onChange={setCustomFrom}
                aria-label="Дата создания с"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">По</p>
              <DatePicker
                value={value.to ?? ''}
                onChange={setCustomTo}
                aria-label="Дата создания по"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!value.from && !value.to}
              onClick={() => setOpen(false)}
            >
              Применить
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
