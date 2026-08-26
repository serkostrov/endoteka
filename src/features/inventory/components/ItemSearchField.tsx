import { useState } from 'react'

import { SearchInput } from '@/components/shared/SearchInput'
import { SearchSuggestOverlay } from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import {
  INVENTORY_PICKER_PAGE_SIZE,
  INVENTORY_SEARCH_DEBOUNCE_MS,
  formatQuantity,
} from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

import { BarcodeScanInput } from './BarcodeScanInput'
import { useInventoryBarcodeLookup, useInventoryStock } from '../hooks/use-inventory'
import { findInventoryItemsByBarcode, type InventoryItem } from '../services/inventory-service'

type ItemSearchFieldProps = {
  onSelect: (item: InventoryItem) => void
  selected?: InventoryItem | null
  onClear?: () => void
  disabled?: boolean
  allowCreate?: boolean
  onCreateRequest?: () => void
  showScan?: boolean
  scanHint?: string
  searchHint?: string
  searchPlaceholder?: string
  defaultOpen?: boolean
}

export function ItemSearchField({
  onSelect,
  selected = null,
  onClear,
  disabled = false,
  allowCreate = false,
  onCreateRequest,
  showScan = true,
  scanHint = 'Сканер сразу находит позицию по штрихкоду',
  searchHint = 'Список всех позиций. Можно сузить поиском.',
  searchPlaceholder = 'Все позиции — введите, чтобы сузить',
  defaultOpen = false,
}: ItemSearchFieldProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(defaultOpen)
  const [scanError, setScanError] = useState<string | null>(null)
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const listQuery = useInventoryStock(debouncedSearch, 1, INVENTORY_PICKER_PAGE_SIZE)
  const barcodeQuery = useInventoryBarcodeLookup(debouncedSearch)
  const term = debouncedSearch.trim()
  const barcodeHits = barcodeQuery.data ?? []
  const items = term && barcodeHits.length > 0 ? barcodeHits : (listQuery.data?.items ?? [])
  const total = listQuery.data?.total ?? 0
  const searching = listQuery.isFetching || (term.length > 0 && barcodeQuery.isFetching)
  const showPanel = open && !disabled

  async function handleScan(code: string) {
    setScanError(null)
    try {
      const found = await findInventoryItemsByBarcode(code)
      const match = found[0]
      if (found.length === 1 && match) {
        onSelect(match)
        setSearch('')
        return
      }
      if (found.length === 0) {
        setScanError('Позиция со штрихкодом не найдена. Воспользуйтесь списком.')
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

  if (selected) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border bg-card px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{selected.name}</p>
          <p className="text-xs text-muted-foreground">
            {selected.code}
            {selected.article ? ` · ${selected.article}` : ''}
            {` · остаток ${formatQuantity(selected.stockQuantity)} ${selected.unitName}`}
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
      <div className="grid gap-3">
        {showScan ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{scanHint}</p>
            <BarcodeScanInput className="w-full" disabled={disabled} onScan={(code) => void handleScan(code)} />
          </div>
        ) : null}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{searchHint}</p>
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
                  <p className="px-3 py-4 text-sm text-muted-foreground">Позиции не найдены</p>
                ) : (
                  <>
                    <ul>
                      {items.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            disabled={disabled}
                            className={cn('flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent')}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              onSelect(item)
                              setSearch('')
                              setOpen(false)
                            }}
                          >
                            <span className="font-medium">{item.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {[item.code, item.article, item.barcode, `${formatQuantity(item.stockQuantity)} ${item.unitName}`]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {!term && total > items.length ? (
                      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                        Показаны первые {items.length} из {total}. Введите текст, чтобы сузить список.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            }
          >
            <SearchInput
              value={search}
              onChange={(next) => {
                setSearch(next)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false)
                }
              }}
              disabled={disabled}
              label="Список номенклатуры"
              placeholder={searchPlaceholder}
              className="max-w-none"
            />
          </SearchSuggestOverlay>
        </div>
        {allowCreate ? (
          <Button type="button" variant="outline" className="w-full" disabled={disabled} onClick={onCreateRequest}>
            Новая позиция
          </Button>
        ) : null}
      </div>
      {scanError ? <p className="text-sm text-destructive">{scanError}</p> : null}
    </div>
  )
}
