import { Columns3, List } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type OrdersViewMode = 'list' | 'kanban'

const views = [
  { id: 'list' as const, label: 'Список', icon: List },
  { id: 'kanban' as const, label: 'Доска', icon: Columns3 },
]

type OrdersViewSwitcherProps = {
  value: OrdersViewMode
  onChange: (view: OrdersViewMode) => void
}

export function OrdersViewSwitcher({ value, onChange }: OrdersViewSwitcherProps) {
  return (
    <div
      role="group"
      aria-label="Вид заказов"
      className="ml-0.5 inline-flex items-center gap-px border-l border-border/80 pl-2.5"
    >
      {views.map((view) => {
        const selected = view.id === value
        const Icon = view.icon

        return (
          <Tooltip key={view.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={view.label}
                aria-pressed={selected}
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded-md transition-colors',
                  selected
                    ? 'text-foreground'
                    : 'text-muted-foreground/55 hover:bg-muted/70 hover:text-foreground',
                )}
                onClick={() => onChange(view.id)}
              >
                <Icon className="size-4" strokeWidth={selected ? 2.25 : 1.75} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{view.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
