import { cn } from '@/lib/utils'

export type PageTabItem<T extends string> = {
  id: T
  label: string
  count?: number
}

type PageTabsProps<T extends string> = {
  value: T
  items: readonly PageTabItem<T>[]
  onChange: (value: T) => void
  'aria-label': string
}

export function PageTabs<T extends string>({ value, items, onChange, 'aria-label': ariaLabel }: PageTabsProps<T>) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-1 overflow-x-auto border-b">
      {items.map((item) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={cn(
              'shrink-0 border-b-2 px-3 py-2 text-sm',
              selected
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {typeof item.count === 'number' && item.count > 0 ? ` (${item.count})` : ''}
          </button>
        )
      })}
    </div>
  )
}
