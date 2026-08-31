import { Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { SearchEmptyCreate, SearchSuggestOverlay } from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  BARCODE_SCAN_IDLE_MS,
  INVENTORY_PICKER_PAGE_SIZE,
  INVENTORY_SEARCH_DEBOUNCE_MS,
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

  function requestCreate() {
    setOpen(false)
    onCreateRequest?.(search.trim())
  }

  useEffect(() => {
    setActiveIndex(0)
  }, [items])

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
          <p className="text-muted-foreground text-xs">
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
        panel={
          <div className="max-h-80 overflow-auto">
            {listQuery.error ? (
              <p className="text-destructive px-3 py-4 text-sm">{getErrorMessage(listQuery.error)}</p>
            ) : searching && items.length === 0 ? (
              <p className="text-muted-foreground px-3 py-4 text-sm">Загрузка списка…</p>
            ) : items.length === 0 ? (
              <SearchEmptyCreate
                message="Ничего не найдено"
                actionLabel="Новый"
                disabled={disabled}
                onCreate={allowCreate ? requestCreate : undefined}
              />
            ) : (
              <>
                <ul>
                  {items.map((item, index) => {
                    const outOfStock = item.stockQuantity <= 0
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          className={cn(
                            'flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm',
                            index === activeIndex ? 'bg-accent' : 'hover:bg-accent/70',
                          )}
                          onMouseEnter={() => setActiveIndex(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose(item)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{item.name}</span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {[item.code, item.article, item.barcode].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'shrink-0 text-xs tabular-nums',
                              outOfStock ? 'text-destructive' : 'text-muted-foreground',
                            )}
                          >
                            {formatQuantity(item.stockQuantity)} {item.unitName}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {!term && total > items.length ? (
                  <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                    Показаны первые {items.length} из {total}. Введите название или артикул.
                  </p>
                ) : null}
              </>
            )}
          </div>
        }
      >
        <div className="relative">
          <label className="sr-only" htmlFor={inputId}>
            Поиск запчасти
          </label>
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            id={inputId}
            value={search}
            disabled={disabled}
            autoComplete="off"
            placeholder={searchPlaceholder}
            className="h-9 pl-8"
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
                const code = search.trim()
                if (showScan && isScanBarcode(code)) {
                  void applyBarcode(code)
                  return
                }
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
      {scanError ? <p className="text-destructive text-sm">{scanError}</p> : null}
    </div>
  )
}
