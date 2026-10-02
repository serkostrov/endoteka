import { useEffect, useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { SearchSuggestOverlay, SearchSuggestPanel } from '@/components/shared/SearchSuggestOverlay'
import { Input } from '@/components/ui/input'
import { useReferenceItemsBySetCode } from '@/features/references/hooks/use-references'
import type { ReferenceItem } from '@/features/references/services/references-service'
import { INVENTORY_SEARCH_DEBOUNCE_MS } from '@/lib/constants/inventory'
import { ReferenceSetCode } from '@/lib/constants/references'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

export type DeviceTypePick = {
  id: string
  name: string
  code: string
  setCode: string
  setName: string
  pathLabel: string
}

type DeviceTypeSearchFieldProps = {
  onSelect: (item: DeviceTypePick) => void
  excludeIds?: Set<string>
  disabled?: boolean
  searchPlaceholder?: string
  suggestSide?: 'top' | 'bottom'
}

const SET_META: Record<string, { setName: string; rank: number }> = {
  [ReferenceSetCode.DeviceGroups]: { setName: 'Группа', rank: 0 },
  [ReferenceSetCode.DeviceBrands]: { setName: 'Бренд', rank: 1 },
  [ReferenceSetCode.DeviceModels]: { setName: 'Модель', rank: 2 },
  [ReferenceSetCode.DeviceModifications]: { setName: 'Модификация', rank: 3 },
}

function buildPath(
  item: ReferenceItem,
  setCode: string,
  byId: Map<string, ReferenceItem>,
): string {
  const chain: string[] = [item.name]
  let parentId = item.parentId
  let guard = 0
  while (parentId && guard < 6) {
    const parent = byId.get(parentId)
    if (!parent) {
      break
    }
    chain.unshift(parent.name)
    parentId = parent.parentId
    guard += 1
  }
  if (setCode === ReferenceSetCode.DeviceGroups) {
    return item.name
  }
  return chain.join(' · ')
}

export function DeviceTypeSearchField({
  onSelect,
  excludeIds,
  disabled = false,
  searchPlaceholder = 'Найти вид прибора',
  suggestSide = 'bottom',
}: DeviceTypeSearchFieldProps) {
  const inputId = useId()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const term = debouncedSearch.trim().toLocaleLowerCase('ru')

  const groupsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceGroups)
  const brandsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceBrands)
  const modelsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceModels)
  const modsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceModifications)

  const loading =
    groupsQuery.isLoading || brandsQuery.isLoading || modelsQuery.isLoading || modsQuery.isLoading

  const options = useMemo(() => {
    const groups = groupsQuery.data ?? []
    const brands = brandsQuery.data ?? []
    const models = modelsQuery.data ?? []
    const mods = modsQuery.data ?? []
    const byId = new Map<string, ReferenceItem>()
    for (const item of [...groups, ...brands, ...models, ...mods]) {
      byId.set(item.id, item)
    }

    const rows: DeviceTypePick[] = []
    const push = (items: ReferenceItem[], setCode: string) => {
      const meta = SET_META[setCode]
      if (!meta) {
        return
      }
      for (const item of items) {
        if (!item.isActive) {
          continue
        }
        if (excludeIds?.has(item.id)) {
          continue
        }
        rows.push({
          id: item.id,
          name: item.name,
          code: item.code,
          setCode,
          setName: meta.setName,
          pathLabel: buildPath(item, setCode, byId),
        })
      }
    }

    push(mods, ReferenceSetCode.DeviceModifications)
    push(models, ReferenceSetCode.DeviceModels)
    push(brands, ReferenceSetCode.DeviceBrands)
    push(groups, ReferenceSetCode.DeviceGroups)
    return rows
  }, [brandsQuery.data, excludeIds, groupsQuery.data, modelsQuery.data, modsQuery.data])

  const filtered = useMemo(() => {
    if (!term) {
      return options.slice(0, 40)
    }
    return options
      .filter((row) => {
        const hay = `${row.pathLabel} ${row.code} ${row.setName}`.toLocaleLowerCase('ru')
        return hay.includes(term)
      })
      .slice(0, 40)
  }, [options, term])

  useEffect(() => {
    setActiveIndex(0)
  }, [filtered])

  function pick(row: DeviceTypePick) {
    onSelect(row)
    setSearch('')
    setOpen(false)
  }

  const showPanel = open && !disabled

  return (
    <SearchSuggestOverlay
      open={showPanel}
      onOpenChange={setOpen}
      side={suggestSide}
      panel={
        <SearchSuggestPanel>
          {loading ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Загрузка видов…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {term ? 'Ничего не найдено' : 'Начните вводить название модели или модификации'}
            </p>
          ) : (
            <ul className="py-1">
              {filtered.map((row, index) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors',
                      index === activeIndex ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pick(row)}
                  >
                    <span className="truncate text-sm font-medium">{row.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {row.setName}
                      {row.pathLabel !== row.name ? ` · ${row.pathLabel}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SearchSuggestPanel>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={inputId}
          value={search}
          disabled={disabled}
          placeholder={searchPlaceholder}
          className="pl-8"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setSearch(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setActiveIndex((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((current) => Math.max(current - 1, 0))
            } else if (event.key === 'Enter') {
              const row = filtered[activeIndex]
              if (row) {
                event.preventDefault()
                pick(row)
              }
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
      </div>
    </SearchSuggestOverlay>
  )
}
