import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Search, X } from 'lucide-react'

import { SearchCreateAction, SearchEmptyCreate, SearchSuggestOverlay, SearchSuggestPanel } from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  BARCODE_SCAN_IDLE_MS,
  INVENTORY_PICKER_PAGE_SIZE,
  INVENTORY_SEARCH_DEBOUNCE_MS,
  formatMoney,
  formatQuantity,
  isScanBarcode,
} from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

import { useInventoryBarcodeLookup, useInventoryStock } from '../hooks/use-inventory'
import { findInventoryItemsByBarcode, type InventoryItem } from '../services/inventory-service'

type ItemSearchFieldProps = {
  onSelect: (item: InventoryItem) => void
  selected?: InventoryItem | null
  onClear?: () => void
  disabled?: boolean
  allowCreate?: boolean
  onCreateRequest?: (query: string) => void
  showScan?: boolean
  onBarcode?: (code: string) => void | Promise<void>
  scanHint?: string
  searchHint?: string
  searchPlaceholder?: string
}

type CategoryGroup = {
  id: string
  name: string
  items: InventoryItem[]
}

export function ItemSearchField({
  onSelect,
  selected = null,
  onClear,
  disabled = false,
  allowCreate = false,
  onCreateRequest,
  showScan = true,
  onBarcode,
  searchPlaceholder = 'Найти запчасть или считать штрихкод',
}: ItemSearchFieldProps) {
  const inputId = useId()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [scanError, setScanError] = useState<string | null>(null)
  const idleRef = useRef(0)
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const listQuery = useInventoryStock(debouncedSearch, 1, INVENTORY_PICKER_PAGE_SIZE)
  const barcodeQuery = useInventoryBarcodeLookup(debouncedSearch)
  const term = debouncedSearch.trim()
  const barcodeHits = barcodeQuery.data ?? []
  const items = term && barcodeHits.length > 0 ? barcodeHits : (listQuery.data?.items ?? [])
  const total = listQuery.data?.total ?? 0
  const searching = listQuery.isFetching || (term.length > 0 && barcodeQuery.isFetching)
  const showPanel = open && !disabled
  const groups = useMemo(() => groupByCategory(items), [items])
  const flatItems = useMemo(() => {
    const rows: InventoryItem[] = []
    for (const group of groups) {
      const groupOpen = Boolean(term) || Boolean(expanded[group.id]) || groups.length === 1
      if (!groupOpen) {
        continue
      }
      rows.push(...group.items)
    }
    return rows
  }, [expanded, groups, term])

  function requestCreate() {
    setOpen(false)
    onCreateRequest?.(search.trim())
  }

  function toggleFolder(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }))
  }

  useEffect(() => {
    setActiveIndex(0)
  }, [flatItems])

  useEffect(() => {
    if (!term) {
      return
    }
    setExpanded((current) => {
      const next = { ...current }
      for (const group of groups) {
        next[group.id] = true
      }
      return next
    })
  }, [groups, term])

  useEffect(() => {
    return () => window.clearTimeout(idleRef.current)
  }, [])

  async function applyBarcode(code: string) {
    setScanError(null)
    window.clearTimeout(idleRef.current)

    if (onBarcode) {
      await onBarcode(code)
      setSearch('')
      setOpen(false)
      return
    }

    try {
      const found = await findInventoryItemsByBarcode(code)
      const match = found[0]
      if (found.length === 1 && match) {
        onSelect(match)
        setSearch('')
        setOpen(false)
        return
      }
      if (found.length === 0) {
        setScanError('Позиция со штрихкодом не найдена.')
        setSearch(code)
        setOpen(true)
        return
      }
      setSearch(code)
      setOpen(true)
    } catch (error) {
      setScanError(getErrorMessage(error))
    }
  }

  function choose(item: InventoryItem) {
    onSelect(item)
    setSearch('')
    setOpen(false)
    setScanError(null)
  }

  if (selected) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{selected.name}</p>
          <p className="text-xs text-muted-foreground">
            {[selected.code, selected.article, `остаток ${formatQuantity(selected.stockQuantity)} ${selected.unitName}`]
              .filter(Boolean)
              .join(' · ')}
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
        contentClassName="w-[min(40rem,calc(100vw-2rem))]"
        panel={
          <SearchSuggestPanel
            footer={
              allowCreate && items.length > 0 ? (
                <SearchCreateAction label="Новый" disabled={disabled} onCreate={requestCreate} />
              ) : null
            }
          >
            <div className="py-1">
              {listQuery.error ? (
                <p className="px-3 py-4 text-sm text-destructive">{getErrorMessage(listQuery.error)}</p>
              ) : searching && items.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">Загрузка списка…</p>
              ) : items.length === 0 ? (
                <SearchEmptyCreate
                  message="Ничего не найдено"
                  actionLabel="Новый"
                  disabled={disabled}
                  onCreate={allowCreate ? requestCreate : undefined}
                />
              ) : (
                <div className="space-y-0.5">
                  {groups.map((group) => {
                    const groupOpen = Boolean(term) || Boolean(expanded[group.id]) || groups.length === 1
                    return (
                      <FolderBlock
                        key={group.id}
                        title={group.name}
                        count={group.items.length}
                        open={groupOpen}
                        onToggle={() => toggleFolder(group.id)}
                      >
                        {group.items.map((item) => {
                          const index = flatItems.findIndex((row) => row.id === item.id)
                          const meta = [item.code, item.article].filter(Boolean).join(' · ')
                          const outOfStock = item.stockQuantity <= 0
                          return (
                            <button
                              key={item.id}
                              type="button"
                              disabled={disabled}
                              className={cn(
                                'flex w-full items-start justify-between gap-3 py-1.5 pr-3 pl-9 text-left text-sm',
                                index === activeIndex ? 'bg-accent' : 'hover:bg-accent/70',
                              )}
                              onMouseEnter={() => {
                                if (index >= 0) {
                                  setActiveIndex(index)
                                }
                              }}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => choose(item)}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium leading-5">{item.name}</span>
                                {meta ? (
                                  <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                                    {meta}
                                  </span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-right text-xs tabular-nums">
                                <span className="block text-muted-foreground">{formatMoney(item.purchasePrice)} ₽</span>
                                <span className={cn(outOfStock ? 'text-destructive' : 'text-muted-foreground')}>
                                  {formatQuantity(item.stockQuantity)} {item.unitName}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </FolderBlock>
                    )
                  })}
                  {!term && total > items.length ? (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                      Показаны первые {items.length} из {total}. Введите название или артикул.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </SearchSuggestPanel>
        }
      >
        <div className="relative">
          <label className="sr-only" htmlFor={inputId}>
            Поиск запчасти
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={inputId}
            value={search}
            disabled={disabled}
            autoComplete="off"
            placeholder={searchPlaceholder}
            className="h-9 pr-16 pl-8"
            onChange={(event) => {
              const next = event.target.value
              setSearch(next)
              setOpen(true)
              setScanError(null)
              window.clearTimeout(idleRef.current)
              if (showScan && isScanBarcode(next)) {
                idleRef.current = window.setTimeout(() => void applyBarcode(next), BARCODE_SCAN_IDLE_MS)
              }
            }}
            onClick={() => setOpen(true)}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false)
                return
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setOpen(true)
                setActiveIndex((current) => Math.min(current + 1, Math.max(flatItems.length - 1, 0)))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((current) => Math.max(current - 1, 0))
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const code = search.trim()
                if (showScan && isScanBarcode(code)) {
                  void applyBarcode(code)
                  return
                }
                const item = flatItems[activeIndex]
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
          <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5">
            {search ? (
              <button
                type="button"
                aria-label="Очистить"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSearch('')
                  setOpen(true)
                }}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              aria-label={open ? 'Скрыть список' : 'Показать список'}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
            </button>
          </div>
        </div>
      </SearchSuggestOverlay>
      {scanError ? <p className="text-sm text-destructive">{scanError}</p> : null}
    </div>
  )
}

function FolderBlock({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const Icon = open ? FolderOpen : Folder
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm font-medium hover:bg-accent/60"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{title}</span>
        <span className="ml-auto text-[11px] font-normal tabular-nums text-muted-foreground">{count}</span>
      </button>
      {open ? <div>{children}</div> : null}
    </div>
  )
}

function groupByCategory(items: InventoryItem[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>()
  for (const item of items) {
    const name = item.categoryName.trim() || 'Без категории'
    const id = `category:${item.categoryId || name}`
    const group = map.get(id) ?? { id, name, items: [] }
    group.items.push(item)
    map.set(id, group)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}
