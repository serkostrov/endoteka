import { useState } from 'react'

import { SearchInput } from '@/components/shared/SearchInput'
import { SearchSuggestOverlay } from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { INVENTORY_SEARCH_DEBOUNCE_MS, INVENTORY_SEARCH_MIN_LENGTH, formatQuantity } from '@/lib/constants/inventory'
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
}

export function ItemSearchField({
  onSelect,
  selected = null,
  onClear,
  disabled = false,
  allowCreate = false,
  onCreateRequest,
  showScan = true,
}: ItemSearchFieldProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const listQuery = useInventoryStock(debouncedSearch, 1, 8)
  const barcodeQuery = useInventoryBarcodeLookup(debouncedSearch)
  const term = debouncedSearch.trim()
  const showManual = term.length >= INVENTORY_SEARCH_MIN_LENGTH
  const items = showManual
    ? (barcodeQuery.data && barcodeQuery.data.length > 0 ? barcodeQuery.data : (listQuery.data?.items ?? []))
    : []
  const searching = showManual && (listQuery.isFetching || barcodeQuery.isFetching)
  const showPanel = open && (searching || showManual)

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
        setScanError('Позиция со штрихкодом не найдена. Воспользуйтесь поиском.')
        setSearch(code)
        return
      }
      setSearch(code)
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
      <div className="grid gap-2">
        {showScan ? <BarcodeScanInput className="w-full" disabled={disabled} onScan={(code) => void handleScan(code)} /> : null}
        <SearchSuggestOverlay
          open={showPanel}
          onOpenChange={setOpen}
          panel={
            <div className="max-h-64 overflow-auto">
              {searching && items.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">Поиск…</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">Позиции не найдены</p>
              ) : (
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
            label="Поиск номенклатуры"
            placeholder="Наименование, артикул, код или штрихкод"
            className="max-w-none"
          />
        </SearchSuggestOverlay>
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
