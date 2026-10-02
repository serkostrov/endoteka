import { useMemo, useState } from 'react'

import { FolderTree, FolderTreeItemButton, nestByFolderKeys } from '@/components/shared/FolderTree'
import { SearchInput } from '@/components/shared/SearchInput'
import { SearchSuggestOverlay, SearchSuggestPanel } from '@/components/shared/SearchSuggestOverlay'
import { useReferenceItemsBySetCode } from '@/features/references/hooks/use-references'
import type { ReferenceItem } from '@/features/references/services/references-service'
import { INVENTORY_SEARCH_DEBOUNCE_MS } from '@/lib/constants/inventory'
import { ReferenceSetCode } from '@/lib/constants/references'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

export type DeviceTypePick = {
  id: string
  name: string
  code: string
  setCode: string
  setName: string
  pathLabel: string
  groupId: string
  groupName: string
  brandId: string
  brandName: string
}

type DeviceTypeSearchFieldProps = {
  onSelect: (item: DeviceTypePick) => void
  excludeIds?: Set<string>
  disabled?: boolean
  searchPlaceholder?: string
  suggestSide?: 'top' | 'bottom'
}

const SET_LABEL: Record<string, string> = {
  [ReferenceSetCode.DeviceModels]: 'Модель',
  [ReferenceSetCode.DeviceModifications]: 'Модификация',
}

export function DeviceTypeSearchField({
  onSelect,
  excludeIds,
  disabled = false,
  searchPlaceholder = 'Найти модель или модификацию',
  suggestSide = 'bottom',
}: DeviceTypeSearchFieldProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
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

    function ancestors(item: ReferenceItem) {
      const brand = item.parentId ? byId.get(item.parentId) : undefined
      const group = brand?.parentId ? byId.get(brand.parentId) : undefined
      return { brand, group }
    }

    for (const model of models) {
      if (!model.isActive || excludeIds?.has(model.id)) {
        continue
      }
      const { brand, group } = ancestors(model)
      const groupName = group?.name.trim() || 'Без типа'
      const brandName = brand?.name.trim() || 'Без бренда'
      rows.push({
        id: model.id,
        name: model.name,
        code: model.code,
        setCode: ReferenceSetCode.DeviceModels,
        setName: SET_LABEL[ReferenceSetCode.DeviceModels] ?? 'Модель',
        pathLabel: [groupName, brandName, model.name].filter(Boolean).join(' · '),
        groupId: group?.id ?? 'none',
        groupName,
        brandId: brand?.id ?? 'none',
        brandName,
      })
    }

    for (const mod of mods) {
      if (!mod.isActive || excludeIds?.has(mod.id)) {
        continue
      }
      const model = mod.parentId ? byId.get(mod.parentId) : undefined
      const brand = model?.parentId ? byId.get(model.parentId) : undefined
      const group = brand?.parentId ? byId.get(brand.parentId) : undefined
      const groupName = group?.name.trim() || 'Без типа'
      const brandName = brand?.name.trim() || 'Без бренда'
      const modelName = model?.name.trim() || ''
      rows.push({
        id: mod.id,
        name: mod.name,
        code: mod.code,
        setCode: ReferenceSetCode.DeviceModifications,
        setName: SET_LABEL[ReferenceSetCode.DeviceModifications] ?? 'Модификация',
        pathLabel: [groupName, brandName, modelName, mod.name].filter(Boolean).join(' · '),
        groupId: group?.id ?? 'none',
        groupName,
        brandId: brand?.id ?? 'none',
        brandName,
      })
    }

    return rows
  }, [brandsQuery.data, excludeIds, groupsQuery.data, modelsQuery.data, modsQuery.data])

  const filtered = useMemo(() => {
    if (!term) {
      return options
    }
    return options.filter((row) => {
      const hay = `${row.pathLabel} ${row.code} ${row.setName}`.toLocaleLowerCase('ru')
      return hay.includes(term)
    })
  }, [options, term])

  const treeGroups = useMemo(
    () =>
      nestByFolderKeys(filtered, [
        (row) => ({
          id: `group:${row.groupId}`,
          name: row.groupName,
        }),
        (row) => ({
          id: `brand:${row.brandId}`,
          name: row.brandName,
        }),
      ]),
    [filtered],
  )

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
              {term ? 'Ничего не найдено' : 'Нет доступных моделей'}
            </p>
          ) : (
            <FolderTree
              groups={treeGroups}
              expandAll={Boolean(term)}
              getItemId={(row) => row.id}
              className="rounded-none border-0"
              renderItem={(row) => {
                const subtitle = [
                  row.setName,
                  row.setCode === ReferenceSetCode.DeviceModifications
                    ? row.pathLabel.split(' · ').slice(0, -1).join(' · ')
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <FolderTreeItemButton
                    depth={2}
                    disabled={disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(row)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{row.name}</span>
                      {subtitle ? (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {subtitle}
                        </span>
                      ) : null}
                    </span>
                  </FolderTreeItemButton>
                )
              }}
            />
          )}
        </SearchSuggestPanel>
      }
    >
      <SearchInput
        value={search}
        onChange={(next) => {
          setSearch(next)
          setOpen(true)
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        disabled={disabled}
        label="Поиск вида прибора"
        placeholder={searchPlaceholder}
        className="max-w-none"
      />
    </SearchSuggestOverlay>
  )
}
