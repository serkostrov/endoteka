import { useMemo, useState } from 'react'
import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react'

import { FilterClearButton } from '@/components/shared/FilterClearButton'
import { activeFilterControlClass } from '@/components/shared/active-filter-style'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { statusBadgeStyle, type OrderStatusCatalogItem } from '../lib/status-catalog'

type OrderStatusMultiFilterProps = {
  options: OrderStatusCatalogItem[]
  value: string[]
  onChange: (codes: string[]) => void
  className?: string
  loading?: boolean
}

function StatusPill({
  name,
  color,
  className,
}: {
  name: string
  color: string | null | undefined
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full truncate rounded-md px-1.5 py-0.5 text-xs font-medium',
        className,
      )}
      style={statusBadgeStyle(color)}
    >
      {name}
    </span>
  )
}

export function OrderStatusMultiFilter({
  options,
  value,
  onChange,
  className,
  loading = false,
}: OrderStatusMultiFilterProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(value), [value])
  const selectedItems = useMemo(
    () =>
      value.flatMap((code) => {
        const item = options.find((option) => option.code === code)
        return item ? [item] : [{ id: code, code, name: code, color: null as string | null }]
      }),
    [options, value],
  )
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) {
      return options
    }
    return options.filter((item) => item.name.toLowerCase().includes(term))
  }, [options, query])

  const isActive = value.length > 0

  function toggle(code: string) {
    if (selected.has(code)) {
      onChange(value.filter((item) => item !== code))
      return
    }
    onChange([...value, code])
  }

  function clearAll() {
    onChange([])
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setQuery('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="select-trigger"
          aria-label="Фильтр по статусу"
          className={activeFilterControlClass(
            isActive,
            cn(
              "flex h-9 w-auto min-w-[10rem] shrink-0 items-center justify-between gap-2 rounded-md border border-input bg-muted px-3 py-0 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-w-0 sm:flex-1 sm:shrink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
              className,
            ),
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {!isActive ? (
              <span className="truncate">Все статусы</span>
            ) : selectedItems.length === 1 && selectedItems[0] ? (
              <StatusPill name={selectedItems[0].name} color={selectedItems[0].color} />
            ) : (
              <>
                {selectedItems.slice(0, 2).map((item) => (
                  <StatusPill key={item.code} name={item.name} color={item.color} />
                ))}
                {selectedItems.length > 2 ? (
                  <span className="shrink-0 text-xs font-medium opacity-90">
                    +{selectedItems.length - 2}
                  </span>
                ) : null}
              </>
            )}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {isActive ? (
              <FilterClearButton onClear={clearAll} label="Сбросить фильтр по статусу" />
            ) : null}
            <ChevronDownIcon className="opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="sticky top-0 z-10 border-b bg-popover p-1.5">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              placeholder="Поиск..."
              aria-label="Поиск статуса"
              autoComplete="off"
              className="h-8 w-full rounded-md border border-input bg-muted pr-2 pl-7 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault()
                  setQuery('')
                }
              }}
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent',
              !isActive && 'bg-accent',
            )}
            onClick={clearAll}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {!isActive ? <CheckIcon className="size-3.5" /> : null}
            </span>
            <span className="truncate">Все статусы</span>
          </button>
          {loading ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Загрузка…</p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Ничего не найдено</p>
          ) : (
            filtered.map((status) => {
              const checked = selected.has(status.code)
              return (
                <button
                  key={status.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent',
                    checked && 'bg-accent',
                  )}
                  onClick={() => toggle(status.code)}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input',
                      checked && 'border-primary bg-primary text-primary-foreground',
                    )}
                    aria-hidden
                  >
                    {checked ? <CheckIcon className="size-3" /> : null}
                  </span>
                  <StatusPill name={status.name} color={status.color} />
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
