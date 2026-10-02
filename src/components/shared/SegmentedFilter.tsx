import { cn } from '@/lib/utils'

import { activeFilterControlClassName } from './active-filter-style'

export type SegmentedFilterOption<T extends string> = {
  value: T
  label: string
}

type SegmentedFilterProps<T extends string> = {
  value: T
  options: readonly SegmentedFilterOption<T>[]
  onChange: (value: T) => void
  'aria-label': string
  /**
   * Значения без «активной» синей подсветки (обычно дефолт вроде «all»).
   * Если не задано — выбранный сегмент остаётся нейтральным (bg-muted).
   */
  inactiveValues?: readonly T[]
}

export function SegmentedFilter<T extends string>({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  inactiveValues,
}: SegmentedFilterProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex h-9 shrink-0 overflow-hidden rounded-md border border-input bg-background shadow-xs"
    >
      {options.map((option) => {
        const selected = option.value === value
        const accent =
          selected && inactiveValues != null && !inactiveValues.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            className={cn(
              'h-full px-3 text-sm whitespace-nowrap transition-colors',
              'border-r border-input last:border-r-0',
              accent
                ? cn(activeFilterControlClassName, 'border-transparent')
                : selected
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
