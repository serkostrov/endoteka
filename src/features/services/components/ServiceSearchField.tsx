import { Search } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { SearchEmptyCreate, SearchSuggestOverlay } from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/constants/inventory'
import { SERVICE_PICKER_PAGE_SIZE, SERVICE_SEARCH_DEBOUNCE_MS } from '@/lib/constants/services'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

import { useServiceTemplates } from '../hooks/use-services'
import type { ServiceTemplate } from '../services/services-service'

type ServiceSearchFieldProps = {
  onSelect: (item: ServiceTemplate) => void
  selected?: ServiceTemplate | null
  onClear?: () => void
  disabled?: boolean
  allowCreate?: boolean
  onCreateRequest?: (query: string) => void
}

export function ServiceSearchField({
  onSelect,
  selected = null,
  onClear,
  disabled = false,
  allowCreate = false,
  onCreateRequest,
}: ServiceSearchFieldProps) {
  const inputId = useId()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const debouncedSearch = useDebouncedValue(search, SERVICE_SEARCH_DEBOUNCE_MS)
  const listQuery = useServiceTemplates(debouncedSearch, 1, SERVICE_PICKER_PAGE_SIZE, true)
  const items = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const searching = listQuery.isFetching
  const showPanel = open && !disabled

  function requestCreate() {
    setOpen(false)
    onCreateRequest?.(search.trim())
  }

  useEffect(() => {
    setActiveIndex(0)
  }, [items])

  function choose(item: ServiceTemplate) {
    onSelect(item)
    setSearch('')
    setOpen(false)
  }

  if (selected) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{selected.name}</p>
          <p className="text-xs text-muted-foreground">
            {selected.description || `${formatMoney(selected.unitPrice)} ₽`}
          </p>
        </div>
        {onClear ? (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onClear}>
            Сменить
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <SearchSuggestOverlay
        open={showPanel}
        onOpenChange={setOpen}
        panel={
          <div className="max-h-80 overflow-auto">
            {listQuery.error ? (
              <p className="px-3 py-4 text-sm text-destructive">{getErrorMessage(listQuery.error)}</p>
            ) : searching && items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">Загрузка списка…</p>
            ) : items.length === 0 ? (
              <SearchEmptyCreate
                message="Услуги не найдены"
                actionLabel="Новый"
                disabled={disabled}
                onCreate={allowCreate ? requestCreate : undefined}
              />
            ) : (
              <>
                <ul>
                  {items.map((item, index) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={disabled}
                        className={cn(
                          'flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm',
                          index === activeIndex ? 'bg-accent' : 'hover:bg-accent/70',
                        )}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => choose(item)}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{item.name}</span>
                          {item.description ? (
                            <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatMoney(item.unitPrice)} ₽
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {!debouncedSearch.trim() && total > items.length ? (
                  <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                    Показаны первые {items.length} из {total}. Введите название.
                  </p>
                ) : null}
              </>
            )}
          </div>
        }
      >
        <div className="relative">
          <label className="sr-only" htmlFor={inputId}>
            Поиск услуги
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={inputId}
            value={search}
            disabled={disabled}
            autoComplete="off"
            placeholder="Найти услугу"
            className="h-10 pl-8"
            onChange={(event) => {
              setSearch(event.target.value)
              setOpen(true)
            }}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false)
                return
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setOpen(true)
                setActiveIndex((current) => Math.min(current + 1, Math.max(items.length - 1, 0)))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((current) => Math.max(current - 1, 0))
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const item = items[activeIndex]
                if (item) {
                  choose(item)
                  return
                }
                if (allowCreate && items.length === 0 && !searching) {
                  requestCreate()
                }
              }
            }}
          />
        </div>
      </SearchSuggestOverlay>
    </div>
  )
}
