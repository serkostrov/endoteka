import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { KeepAliveTab } from '@/components/shared/KeepAliveTab'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageTabs } from '@/components/shared/PageTabs'
import { SectionCard } from '@/components/shared/SectionCard'
import { SheetEntityToolbar } from '@/components/shared/SheetEntityToolbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetDirty,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useHasPermission } from '@/features/auth'
import {
  DynamicFieldRenderer,
  DynamicFieldValue,
  DynamicFieldsGrid,
  saveDynamicFieldValues,
} from '@/features/dynamic-fields'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'
import { DeviceCompatiblePartsPanel } from '@/features/devices/components/DeviceCompatiblePartsPanel'
import { ReferenceItemPhotos } from '@/features/devices/components/ReferenceItemPhotos'
import { useDeviceCompatibleParts } from '@/features/devices/hooks/use-compatible-parts'
import { ReferenceItemDialog } from '@/features/references/components/ReferenceItemDialog'
import {
  useDeleteReferenceItem,
  useReferenceItemsBySetCode,
  useReferenceSets,
  useUpsertReferenceItem,
} from '@/features/references/hooks/use-references'
import type { ReferenceItemFormValues } from '@/features/references/schemas'
import type { ReferenceItem, ReferenceSetSummary } from '@/features/references/services/references-service'
import { FieldEntity, fieldLayoutWidthClass } from '@/lib/constants/fields'
import { Permission } from '@/lib/constants/permissions'
import { ReferenceSetCode } from '@/lib/constants/references'
import { getErrorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { uniqueCode } from '@/lib/utils/code'
import { formatInteger } from '@/lib/utils/number'
import { cn } from '@/lib/utils'

type ColumnKey = 'group' | 'brand' | 'model' | 'modification'

/** Дети выбранного родителя — только жёсткая привязка по parent_id. */
function filterChildren(items: ReferenceItem[], parentId: string | null) {
  if (!parentId) {
    return []
  }
  return items.filter((item) => Boolean(item.parentId) && item.parentId === parentId)
}

const COLUMNS: {
  key: ColumnKey
  code: ReferenceSetCode
  title: string
  addLabel: string
}[] = [
  { key: 'group', code: ReferenceSetCode.DeviceGroups, title: 'Группа', addLabel: 'Группа' },
  { key: 'brand', code: ReferenceSetCode.DeviceBrands, title: 'Бренд', addLabel: 'Бренд' },
  { key: 'model', code: ReferenceSetCode.DeviceModels, title: 'Модель', addLabel: 'Модель' },
  {
    key: 'modification',
    code: ReferenceSetCode.DeviceModifications,
    title: 'Модификация',
    addLabel: 'Модификация',
  },
]

export function DeviceTypesBrowser() {
  const canUpdate = useHasPermission(Permission.SettingsUpdate)
  const setsQuery = useReferenceSets()
  const groupsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceGroups)
  const brandsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceBrands)
  const modelsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceModels)
  const modsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceModifications)

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [selectedModId, setSelectedModId] = useState<string | null>(null)

  const [editor, setEditor] = useState<{
    column: ColumnKey
    item: ReferenceItem | null
    parentId: string
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ column: ColumnKey; item: ReferenceItem } | null>(
    null,
  )
  const [detail, setDetail] = useState<{ column: ColumnKey; item: ReferenceItem } | null>(null)

  const setsByCode = useMemo(() => {
    const map = new Map<string, ReferenceSetSummary>()
    for (const set of setsQuery.data ?? []) {
      map.set(set.code, set)
    }
    return map
  }, [setsQuery.data])

  const groups = groupsQuery.data ?? []
  const allBrands = brandsQuery.data ?? []
  const brands = useMemo(
    () => filterChildren(allBrands, selectedGroupId),
    [allBrands, selectedGroupId],
  )
  const models = useMemo(
    () => filterChildren(modelsQuery.data ?? [], selectedBrandId),
    [modelsQuery.data, selectedBrandId],
  )
  const modifications = useMemo(
    () => filterChildren(modsQuery.data ?? [], selectedModelId),
    [modsQuery.data, selectedModelId],
  )
  const columnItems: Record<ColumnKey, ReferenceItem[]> = {
    group: groups,
    brand: brands,
    model: models,
    modification: modifications,
  }

  const selectedIds: Record<ColumnKey, string | null> = {
    group: selectedGroupId,
    brand: selectedBrandId,
    model: selectedModelId,
    modification: selectedModId,
  }

  const loading =
    setsQuery.isLoading ||
    groupsQuery.isLoading ||
    brandsQuery.isLoading ||
    modelsQuery.isLoading ||
    modsQuery.isLoading

  const error =
    setsQuery.error || groupsQuery.error || brandsQuery.error || modelsQuery.error || modsQuery.error

  function setForColumn(column: ColumnKey) {
    const code = COLUMNS.find((item) => item.key === column)!.code
    return setsByCode.get(code)
  }

  function select(column: ColumnKey, id: string) {
    if (column === 'group') {
      setSelectedGroupId(id)
      setSelectedBrandId(null)
      setSelectedModelId(null)
      setSelectedModId(null)
      return
    }
    if (column === 'brand') {
      setSelectedBrandId(id)
      setSelectedModelId(null)
      setSelectedModId(null)
      return
    }
    if (column === 'model') {
      setSelectedModelId(id)
      setSelectedModId(null)
      return
    }
    setSelectedModId(id)
  }

  function openCreate(column: ColumnKey) {
    if (column === 'brand' && !selectedGroupId) {
      toast.message('Сначала выберите группу')
      return
    }
    if (column === 'model' && !selectedBrandId) {
      toast.message('Сначала выберите бренд')
      return
    }
    if (column === 'modification' && !selectedModelId) {
      toast.message('Сначала выберите модель')
      return
    }
    const parentId =
      column === 'brand'
        ? (selectedGroupId ?? '')
        : column === 'model'
          ? (selectedBrandId ?? '')
          : column === 'modification'
            ? (selectedModelId ?? '')
            : ''
    setEditor({ column, item: null, parentId })
  }

  function openEdit(column: ColumnKey, item: ReferenceItem) {
    setEditor({
      column,
      item,
      parentId:
        column === 'brand'
          ? (item.parentId ?? selectedGroupId ?? '')
          : column === 'model'
            ? (item.parentId ?? selectedBrandId ?? '')
            : column === 'modification'
              ? (item.parentId ?? selectedModelId ?? '')
              : (item.parentId ?? ''),
    })
  }

  const editorSet = editor ? setForColumn(editor.column) : null
  const editorRequiresParent =
    editor?.column === 'brand' || editor?.column === 'model' || editor?.column === 'modification'
  const editorParentLabel =
    editor?.column === 'brand'
      ? 'Группа'
      : editor?.column === 'model'
        ? 'Бренд'
        : editor?.column === 'modification'
          ? 'Модель'
          : null

  const modelParentGroupId = editor?.item?.parentId
    ? (brandsQuery.data ?? []).find((brand) => brand.id === editor.item?.parentId)?.parentId
    : selectedGroupId

  const resolvedParentOptions =
    editor?.column === 'brand'
      ? groups.filter((item) => item.isActive || item.id === editor.item?.parentId)
      : editor?.column === 'model'
        ? (brandsQuery.data ?? []).filter((item) => {
            if (!(item.isActive || item.id === editor.item?.parentId)) {
              return false
            }
            if (item.id === editor.parentId || item.id === selectedBrandId) {
              return true
            }
            if (!modelParentGroupId) {
              return false
            }
            return item.parentId === modelParentGroupId
          })
        : editor?.column === 'modification'
          ? (modelsQuery.data ?? []).filter((item) => {
              if (!(item.isActive || item.id === editor.item?.parentId)) {
                return false
              }
              if (item.id === editor.parentId || item.id === selectedModelId) {
                return true
              }
              if (!selectedBrandId) {
                return false
              }
              return item.parentId === selectedBrandId
            })
          : []

  const siblingItems =
    editor?.column === 'group'
      ? groups
      : editor?.column === 'brand'
        ? (brandsQuery.data ?? []).filter(
            (item) => item.parentId === (editor.parentId || selectedGroupId),
          )
        : editor?.column === 'model'
          ? (modelsQuery.data ?? []).filter(
              (item) => item.parentId === (editor.parentId || selectedBrandId),
            )
          : editor?.column === 'modification'
            ? (modsQuery.data ?? []).filter(
                (item) => item.parentId === (editor.parentId || selectedModelId),
              )
            : []

  if (loading) {
    return <LoadingState label="Загрузка видов приборов" />
  }

  if (error) {
    return <ErrorState description={getErrorMessage(error)} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-4">
        {COLUMNS.map((column) => {
          const items = columnItems[column.key]
          const selectedId = selectedIds[column.key]
          const emptyHint =
            column.key === 'brand' && !selectedGroupId
              ? 'Выберите группу слева, чтобы увидеть бренды.'
              : column.key === 'brand' && selectedGroupId
                ? 'В этой группе пока нет брендов. Добавьте бренд сверху.'
                : column.key === 'model' && !selectedBrandId
                  ? 'Выберите бренд слева, чтобы увидеть модели.'
                  : column.key === 'model' && selectedBrandId
                    ? 'У этого бренда пока нет моделей. Добавьте модель сверху.'
                    : column.key === 'modification' && !selectedModelId
                      ? 'Выберите модель слева, чтобы увидеть модификации.'
                      : column.key === 'modification' && selectedModelId
                        ? 'У этой модели пока нет модификаций. Добавьте модификацию сверху.'
                        : 'Добавьте элементы справочника, чтобы ускорить создание приборов.'

          const canAdd =
            column.key === 'group' ||
            (column.key === 'brand' && Boolean(selectedGroupId)) ||
            (column.key === 'model' && Boolean(selectedBrandId)) ||
            (column.key === 'modification' && Boolean(selectedModelId))
          const addDisabledHint =
            column.key === 'brand'
              ? 'Сначала выберите группу слева'
              : column.key === 'model'
                ? 'Сначала выберите бренд слева'
                : column.key === 'modification'
                  ? 'Сначала выберите модель слева'
                  : undefined

          return (
            <MillerColumn
              key={column.key}
              title={column.title}
              addLabel={column.addLabel}
              items={items}
              selectedId={selectedId}
              previewId={detail?.column === column.key ? detail.item.id : null}
              canUpdate={canUpdate}
              canAdd={canAdd}
              addDisabledHint={addDisabledHint}
              emptyHint={emptyHint}
              showCascadeHint={column.key !== 'modification'}
              openDetailOnBody={column.key === 'model' || column.key === 'modification'}
              onAdd={() => openCreate(column.key)}
              onSelect={(id) => select(column.key, id)}
              onOpenDetail={(item) => setDetail({ column: column.key, item })}
              onEdit={(item) => openEdit(column.key, item)}
              onDelete={(item) => setDeleteTarget({ column: column.key, item })}
            />
          )
        })}
      </div>

      <TypeDetailSheet
        detail={detail}
        set={detail ? setForColumn(detail.column) : null}
        groups={groups}
        brands={allBrands}
        models={modelsQuery.data ?? []}
        parentLabel={
          detail?.column === 'brand'
            ? 'Группа'
            : detail?.column === 'model'
              ? 'Бренд'
              : detail?.column === 'modification'
                ? 'Модель'
                : null
        }
        parentOptions={
          detail?.column === 'brand'
            ? groups.filter((item) => item.isActive || item.id === detail.item.parentId)
            : detail?.column === 'model'
              ? (brandsQuery.data ?? []).filter((item) => {
                  if (!(item.isActive || item.id === detail.item.parentId)) {
                    return false
                  }
                  const groupId =
                    (brandsQuery.data ?? []).find((brand) => brand.id === detail.item.parentId)
                      ?.parentId ?? selectedGroupId
                  if (item.id === detail.item.parentId || item.id === selectedBrandId) {
                    return true
                  }
                  return groupId ? item.parentId === groupId : false
                })
              : detail?.column === 'modification'
                ? (modelsQuery.data ?? []).filter((item) => {
                    if (!(item.isActive || item.id === detail.item.parentId)) {
                      return false
                    }
                    if (item.id === detail.item.parentId || item.id === selectedModelId) {
                      return true
                    }
                    return selectedBrandId ? item.parentId === selectedBrandId : false
                  })
                : []
        }
        siblingItems={
          detail?.column === 'group'
            ? groups
            : detail?.column === 'brand'
              ? (brandsQuery.data ?? [])
              : detail?.column === 'model'
                ? (modelsQuery.data ?? [])
                : detail?.column === 'modification'
                  ? (modsQuery.data ?? [])
                  : []
        }
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null)
          }
        }}
        onItemChange={(item) => {
          if (!detail) {
            return
          }
          setDetail({ ...detail, item })
        }}
        onDelete={() => {
          if (!detail) {
            return
          }
          const { column, item } = detail
          setDetail(null)
          setDeleteTarget({ column, item })
        }}
        canUpdate={canUpdate}
      />

      {editor && editorSet ? (
        <ColumnEditor
          set={editorSet}
          item={editor.item}
          parentId={editor.parentId}
          requiresParent={editorRequiresParent}
          parentLabel={editorParentLabel}
          parentOptions={resolvedParentOptions}
          allItems={siblingItems}
          onClose={() => setEditor(null)}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteReferenceItem
          setId={setForColumn(deleteTarget.column)?.id ?? ''}
          item={deleteTarget.item}
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null)
            }
          }}
          onDeleted={() => {
            const { column, item } = deleteTarget
            if (column === 'group' && selectedGroupId === item.id) {
              setSelectedGroupId(null)
              setSelectedBrandId(null)
              setSelectedModelId(null)
              setSelectedModId(null)
            }
            if (column === 'brand' && selectedBrandId === item.id) {
              setSelectedBrandId(null)
              setSelectedModelId(null)
              setSelectedModId(null)
            }
            if (column === 'model' && selectedModelId === item.id) {
              setSelectedModelId(null)
              setSelectedModId(null)
            }
            if (column === 'modification' && selectedModId === item.id) {
              setSelectedModId(null)
            }
            setDeleteTarget(null)
          }}
        />
      ) : null}
    </div>
  )
}


function MillerColumnRow({
  item,
  selected,
  previewed,
  showCascadeHint,
  openDetailOnBody,
  canUpdate,
  onSelect,
  onOpenDetail,
  onEdit,
  onDelete,
}: {
  item: ReferenceItem
  selected: boolean
  previewed: boolean
  showCascadeHint?: boolean
  openDetailOnBody?: boolean
  canUpdate: boolean
  onSelect: (id: string) => void
  onOpenDetail: (item: ReferenceItem) => void
  onEdit: (item: ReferenceItem) => void
  onDelete: (item: ReferenceItem) => void
}) {
  const highlighted = selected || previewed

  return (
    <li>
      <div
        className={cn(
          'group relative flex w-full items-center gap-0.5 px-1 py-0.5 text-sm transition-colors',
          highlighted ? 'bg-accent' : 'hover:bg-accent/60',
          !item.isActive && 'opacity-60',
        )}
      >
        <button
          type="button"
          className={cn(
            'min-w-0 flex-1 truncate py-1.5 pl-2 text-left font-medium',
            showCascadeHint ? 'pr-10' : 'pr-2',
            canUpdate && 'group-hover:pr-20',
          )}
          onClick={() => {
            if (openDetailOnBody) {
              onOpenDetail(item)
              return
            }
            onSelect(item.id)
          }}
        >
          {item.name}
        </button>
        {canUpdate ? (
          <div
            className={cn(
              'absolute top-1/2 flex -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
              showCascadeHint ? 'right-9' : 'right-1',
            )}
          >
            <IconActionButton label="Изменить" size="icon-sm" onClick={() => onEdit(item)}>
              <Pencil />
            </IconActionButton>
            <IconActionButton
              label="Удалить"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(item)}
            >
              <Trash2 />
            </IconActionButton>
          </div>
        ) : null}
        {showCascadeHint ? (
          <button
            type="button"
            className={cn(
              'absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground',
              !highlighted && 'opacity-50 group-hover:opacity-100',
            )}
            aria-label={`Открыть «${item.name}»`}
            onClick={() => onSelect(item.id)}
          >
            <ChevronRight className="size-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  )
}

function MillerColumn({
  title,
  addLabel,
  items,
  selectedId,
  previewId,
  canUpdate,
  canAdd,
  addDisabledHint,
  emptyHint,
  showCascadeHint,
  openDetailOnBody,
  onAdd,
  onSelect,
  onOpenDetail,
  onEdit,
  onDelete,
}: {
  title: string
  addLabel: string
  items: ReferenceItem[]
  selectedId: string | null
  previewId: string | null
  canUpdate: boolean
  canAdd: boolean
  addDisabledHint?: string
  emptyHint: string
  showCascadeHint?: boolean
  openDetailOnBody?: boolean
  onAdd: () => void
  onSelect: (id: string) => void
  onOpenDetail: (item: ReferenceItem) => void
  onEdit: (item: ReferenceItem) => void
  onDelete: (item: ReferenceItem) => void
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="border-b p-2">
        {canUpdate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-start"
            disabled={!canAdd}
            title={!canAdd ? addDisabledHint : undefined}
            onClick={onAdd}
          >
            <Plus className="size-3.5" />
            {addLabel}
          </Button>
        ) : (
          <p className="px-1 text-sm font-medium">{title}</p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState
            title="Здесь пока ничего нет"
            description={emptyHint}
            className="m-3 border-0 bg-transparent py-8"
          />
        ) : (
          <ul>
            {items.map((item) => (
              <MillerColumnRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                previewed={item.id === previewId}
                showCascadeHint={showCascadeHint}
                openDetailOnBody={openDetailOnBody}
                canUpdate={canUpdate}
                onSelect={onSelect}
                onOpenDetail={onOpenDetail}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        Всего — {formatInteger(items.length)}
      </p>
    </section>
  )
}

function buildClassificationPath(
  column: ColumnKey,
  item: ReferenceItem,
  groups: ReferenceItem[],
  brands: ReferenceItem[],
  models: ReferenceItem[],
): { label: string; value: string }[] {
  if (column === 'group') {
    return [{ label: 'Группа', value: item.name }]
  }

  if (column === 'brand') {
    const group = groups.find((row) => row.id === item.parentId)
    return [
      ...(group ? [{ label: 'Группа', value: group.name }] : []),
      { label: 'Бренд', value: item.name },
    ]
  }

  if (column === 'model') {
    const brand = brands.find((row) => row.id === item.parentId)
    const group = brand ? groups.find((row) => row.id === brand.parentId) : undefined
    return [
      ...(group ? [{ label: 'Группа', value: group.name }] : []),
      ...(brand ? [{ label: 'Бренд', value: brand.name }] : []),
      { label: 'Модель', value: item.name },
    ]
  }

  const model = models.find((row) => row.id === item.parentId)
  const brand = model ? brands.find((row) => row.id === model.parentId) : undefined
  const group = brand ? groups.find((row) => row.id === brand.parentId) : undefined
  return [
    ...(group ? [{ label: 'Группа', value: group.name }] : []),
    ...(brand ? [{ label: 'Бренд', value: brand.name }] : []),
    ...(model ? [{ label: 'Модель', value: model.name }] : []),
    { label: 'Модификация', value: item.name },
  ]
}

function TypeDetailSheet({
  detail,
  set,
  groups,
  brands,
  models,
  parentLabel,
  parentOptions,
  siblingItems,
  canUpdate,
  onOpenChange,
  onItemChange,
  onDelete,
}: {
  detail: { column: ColumnKey; item: ReferenceItem } | null
  set: ReferenceSetSummary | null | undefined
  groups: ReferenceItem[]
  brands: ReferenceItem[]
  models: ReferenceItem[]
  parentLabel: string | null
  parentOptions: ReferenceItem[]
  siblingItems: ReferenceItem[]
  canUpdate: boolean
  onOpenChange: (open: boolean) => void
  onItemChange: (item: ReferenceItem) => void
  onDelete: () => void
}) {
  const open = Boolean(detail)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {detail && set ? (
        <TypeDetailSheetContent
          key={detail.item.id}
          column={detail.column}
          item={detail.item}
          set={set}
          groups={groups}
          brands={brands}
          models={models}
          parentLabel={parentLabel}
          parentOptions={parentOptions}
          siblingItems={siblingItems}
          canUpdate={canUpdate}
          onItemChange={onItemChange}
          onDelete={onDelete}
        />
      ) : null}
    </Sheet>
  )
}

function TypeDetailSheetContent({
  column,
  item,
  set,
  groups,
  brands,
  models,
  parentLabel,
  parentOptions,
  siblingItems,
  canUpdate,
  onItemChange,
  onDelete,
}: {
  column: ColumnKey
  item: ReferenceItem
  set: ReferenceSetSummary
  groups: ReferenceItem[]
  brands: ReferenceItem[]
  models: ReferenceItem[]
  parentLabel: string | null
  parentOptions: ReferenceItem[]
  siblingItems: ReferenceItem[]
  canUpdate: boolean
  onItemChange: (item: ReferenceItem) => void
  onDelete: () => void
}) {
  const save = useUpsertReferenceItem(set.id)
  const [tab, setTab] = useState<'card' | 'compatible'>('card')
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description)
  const [parentId, setParentId] = useState(item.parentId ?? '')
  const partsQuery = useDeviceCompatibleParts(item.id)
  const compatibleCount = partsQuery.data?.length ?? 0
  const dirty =
    name.trim() !== item.name.trim() ||
    description.trim() !== item.description.trim() ||
    parentId !== (item.parentId ?? '')

  useSheetDirty(dirty && canUpdate)

  const path = buildClassificationPath(
    column,
    { ...item, name: name.trim() || item.name, parentId: parentId || item.parentId },
    groups,
    brands,
    models,
  )
  const requiresParent = Boolean(parentLabel)
  const pathTitle = path.map((step) => step.value).join(' · ')
  const tabItems = useMemo(
    () => [
      { id: 'card' as const, label: 'Карточка' },
      { id: 'compatible' as const, label: 'Запасные части', count: compatibleCount },
    ],
    [compatibleCount],
  )

  async function persist(next: { name: string; description: string; parentId: string }) {
    const trimmedName = next.name.trim()
    if (!trimmedName) {
      toast.error('Укажите название')
      setName(item.name)
      return
    }
    if (requiresParent && !next.parentId) {
      toast.error(`Выберите ${parentLabel}`)
      return
    }
    const effectiveParentId = requiresParent ? next.parentId || null : null
    const nameTaken = siblingItems.some(
      (row) =>
        row.id !== item.id &&
        (row.parentId ?? null) === effectiveParentId &&
        row.name.trim().toLowerCase() === trimmedName.toLowerCase(),
    )
    if (nameTaken) {
      toast.error('Запись с таким названием уже есть на этом уровне.')
      return
    }

    try {
      await save.mutateAsync({
        id: item.id,
        setId: set.id,
        code: item.code,
        name: trimmedName,
        description: next.description.trim(),
        parentId: effectiveParentId,
      })
      const parent = parentOptions.find((row) => row.id === effectiveParentId)
      onItemChange({
        ...item,
        name: trimmedName,
        description: next.description.trim(),
        parentId: effectiveParentId,
        parentName: parent?.name ?? item.parentName,
        parentCode: parent?.code ?? item.parentCode,
      })
      toast.success('Сохранено')
    } catch (error) {
      toast.error(getErrorMessage(error))
      setName(item.name)
      setDescription(item.description)
      setParentId(item.parentId ?? '')
    }
  }

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(96vw,40rem)]"
      onOpenAutoFocus={(event) => event.preventDefault()}
      actions={canUpdate ? <SheetEntityToolbar onDelete={onDelete} /> : null}
    >
      <SheetHeader className="sr-only">
        <SheetTitle>{pathTitle}</SheetTitle>
        <SheetDescription>Карточка вида прибора: {pathTitle}.</SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-3 p-5 pr-14">
        <h2 className="text-xl font-semibold leading-snug tracking-tight">{pathTitle}</h2>

        <PageTabs
          aria-label="Разделы вида прибора"
          value={tab}
          onChange={setTab}
          items={tabItems}
        />

        <KeepAliveTab active={tab === 'card'}>
          <SectionCard className="gap-4 py-4">
            <div className="space-y-4">
              <ReferenceItemPhotos referenceItemId={item.id} canEdit={canUpdate} />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`type-name-${item.id}`}>Название</Label>
                  <Input
                    id={`type-name-${item.id}`}
                    value={name}
                    placeholder="Название"
                    disabled={!canUpdate || save.isPending}
                    readOnly={!canUpdate}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => {
                      if (!canUpdate || name.trim() === item.name.trim()) {
                        return
                      }
                      void persist({ name, description, parentId })
                    }}
                  />
                </div>
                {requiresParent && parentLabel ? (
                  <div className="space-y-2">
                    <Label>{parentLabel}</Label>
                    {canUpdate ? (
                      <Select
                        value={parentId}
                        disabled={save.isPending}
                        onValueChange={(value) => {
                          setParentId(value)
                          void persist({ name, description, parentId: value })
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={`Выберите ${parentLabel.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent searchable>
                          {parentOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                              {option.isActive ? '' : ' (скрыт)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={parentOptions.find((row) => row.id === parentId)?.name ?? '—'}
                        readOnly
                        disabled
                      />
                    )}
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor={`type-code-${item.id}`}>Код</Label>
                  <Input id={`type-code-${item.id}`} value={item.code} readOnly disabled />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`type-desc-${item.id}`}>Описание</Label>
                  <Textarea
                    id={`type-desc-${item.id}`}
                    value={description}
                    disabled={!canUpdate || save.isPending}
                    placeholder="Необязательно"
                    className="min-h-24 resize-y"
                    onChange={(event) => setDescription(event.target.value)}
                    onBlur={() => {
                      if (!canUpdate || description.trim() === item.description.trim()) {
                        return
                      }
                      void persist({ name, description, parentId })
                    }}
                  />
                </div>
              </div>
            </div>
          </SectionCard>
          <DeviceTypeFieldsSection referenceItemId={item.id} canEdit={canUpdate} />
        </KeepAliveTab>

        <KeepAliveTab active={tab === 'compatible'}>
          <DeviceCompatiblePartsPanel referenceItemId={item.id} canUpdate={canUpdate} />
        </KeepAliveTab>
      </div>
    </SheetContent>
  )
}

function DeviceTypeFieldsSection({
  referenceItemId,
  canEdit,
}: {
  referenceItemId: string
  canEdit: boolean
}) {
  const fieldsQuery = useDynamicFields(FieldEntity.Devices)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Devices, referenceItemId)
  const queryClient = useQueryClient()
  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const [extraDraft, setExtraDraft] = useState<Record<string, DynamicFieldValueData> | null>(null)
  const extraValues = extraDraft ?? valuesQuery.data ?? {}
  useSheetDirty(canEdit && extraDraft !== null, extraDraft ? () => saveExtra() : undefined)

  if (activeFields.length === 0) {
    return null
  }

  async function saveExtra() {
    try {
      await saveDynamicFieldValues(FieldEntity.Devices, referenceItemId, extraValues)
      setExtraDraft(null)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fields.values(FieldEntity.Devices, referenceItemId),
      })
      toast.success('Поля сохранены')
    } catch (error) {
      toast.error(getErrorMessage(error))
      throw error
    }
  }

  return (
    <SectionCard title="Дополнительные поля">
      {canEdit ? (
        <DynamicFieldsGrid className="gap-3">
          {activeFields.map((field) => (
            <DynamicFieldRenderer
              key={field.id}
              field={field}
              value={extraValues[field.code] ?? emptyFieldValue(field)}
              onChange={(value) =>
                setExtraDraft((current) => ({
                  ...(current ?? valuesQuery.data ?? {}),
                  [field.code]: value,
                }))
              }
            />
          ))}
        </DynamicFieldsGrid>
      ) : (
        <dl className="grid grid-cols-12 gap-3 text-sm">
          {activeFields.map((field) => (
            <div key={field.id} className={fieldLayoutWidthClass(field)}>
              <dt className="text-muted-foreground">{field.name}</dt>
              <dd className="mt-0.5 font-medium">
                <DynamicFieldValue
                  field={field}
                  value={extraValues[field.code] ?? emptyFieldValue(field)}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </SectionCard>
  )
}

function ColumnEditor({
  set,
  item,
  parentId,
  requiresParent,
  parentLabel,
  parentOptions,
  allItems,
  onClose,
}: {
  set: ReferenceSetSummary
  item: ReferenceItem | null
  parentId: string
  requiresParent: boolean
  parentLabel: string | null
  parentOptions: ReferenceItem[]
  allItems: ReferenceItem[]
  onClose: () => void
}) {
  const save = useUpsertReferenceItem(set.id)

  return (
    <ReferenceItemDialog
      open
      setName={set.name}
      requiresParent={requiresParent}
      parentLabel={parentLabel}
      parentOptions={parentOptions}
      item={item}
      defaultParentId={parentId}
      lockParent={requiresParent && Boolean(parentId)}
      isPending={save.isPending}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
      onSubmit={async (values: ReferenceItemFormValues) => {
        const effectiveParentId = requiresParent ? parentId || values.parentId || null : null
        const siblingRows = allItems.filter(
          (row) => row.id !== item?.id && (row.parentId ?? null) === effectiveParentId,
        )
        const nameTaken = siblingRows.some(
          (row) => row.name.trim().toLowerCase() === values.name.trim().toLowerCase(),
        )
        if (nameTaken) {
          throw new Error('Запись с таким названием уже есть на этом уровне.')
        }
        const setCodes = allItems.filter((row) => row.id !== item?.id).map((row) => row.code ?? '')
        await save.mutateAsync({
          id: item?.id,
          setId: set.id,
          code: item?.code ?? uniqueCode(values.name, setCodes),
          name: values.name,
          description: values.description,
          parentId: effectiveParentId,
        })
        toast.success('Запись сохранена')
        onClose()
      }}
    />
  )
}

function DeleteReferenceItem({
  setId,
  item,
  open,
  onOpenChange,
  onDeleted,
}: {
  setId: string
  item: ReferenceItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const remove = useDeleteReferenceItem(setId)

  return (
    <ConfirmDialog
      open={open}
      title="Удалить запись"
      description={`${item.name} будет удалена. Если она используется в приборах, удаление не пройдёт.`}
      confirmLabel="Удалить"
      isPending={remove.isPending}
      onOpenChange={onOpenChange}
      onConfirm={() => {
        void remove
          .mutateAsync(item.id)
          .then(() => {
            toast.success('Запись удалена')
            onDeleted()
          })
          .catch((error) => toast.error(getErrorMessage(error)))
      }}
    />
  )
}
