import { cn } from '@/lib/utils'

export type SegmentedFilterOption<T extends string> = {
  value: T
  label: string
}

type SegmentedFilterProps<T extends string> = {
  value: T
  options: readonly SegmentedFilterOption<T>[]
  onChange: (value: T) => void
  'aria-label': string
}

export function SegmentedFilter<T extends string>({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
}: SegmentedFilterProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex h-9 shrink-0 overflow-hidden rounded-md border border-input bg-background shadow-xs"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            className={cn(
              'h-full px-3 text-sm whitespace-nowrap transition-colors',
              'border-r border-input last:border-r-0',
              selected
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
