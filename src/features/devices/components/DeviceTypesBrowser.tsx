import { useMemo, useState } from 'react'
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { ReferenceItemDialog } from '@/features/references/components/ReferenceItemDialog'
import {
  useDeleteReferenceItem,
  useReferenceItemsBySetCode,
  useReferenceSets,
  useUpsertReferenceItem,
} from '@/features/references/hooks/use-references'
import type { ReferenceItemFormValues } from '@/features/references/schemas'
import type { ReferenceItem, ReferenceSetSummary } from '@/features/references/services/references-service'
import { Permission } from '@/lib/constants/permissions'
import { ReferenceSetCode } from '@/lib/constants/references'
import { getErrorMessage } from '@/lib/errors'
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
      <p className="shrink-0 text-sm text-muted-foreground">
        Дерево: в группе — свои бренды, в бренде — модели, в модели — модификации.
      </p>

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
              canUpdate={canUpdate}
              canAdd={canAdd}
              addDisabledHint={addDisabledHint}
              emptyHint={emptyHint}
              showCascadeHint={column.key !== 'modification'}
              onAdd={() => openCreate(column.key)}
              onSelect={(id) => select(column.key, id)}
              onEdit={(item) => openEdit(column.key, item)}
              onDelete={(item) => setDeleteTarget({ column: column.key, item })}
            />
          )
        })}
      </div>

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
  showCascadeHint,
  canUpdate,
  onSelect,
  onEdit,
  onDelete,
}: {
  item: ReferenceItem
  selected: boolean
  showCascadeHint?: boolean
  canUpdate: boolean
  onSelect: (id: string) => void
  onEdit: (item: ReferenceItem) => void
  onDelete: (item: ReferenceItem) => void
}) {
  return (
    <li>
      <div
        className={cn(
          'group flex w-full items-center gap-1 px-1 py-0.5 text-sm transition-colors',
          selected ? 'bg-accent' : 'hover:bg-accent/60',
          !item.isActive && 'opacity-60',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
          onClick={() => onSelect(item.id)}
        >
          <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
          {showCascadeHint ? (
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground',
                !selected && 'opacity-0 group-hover:opacity-40',
              )}
            />
          ) : null}
        </button>
        {canUpdate ? (
          <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
      </div>
    </li>
  )
}

function MillerColumn({
  title,
  addLabel,
  items,
  selectedId,
  canUpdate,
  canAdd,
  addDisabledHint,
  emptyHint,
  showCascadeHint,
  onAdd,
  onSelect,
  onEdit,
  onDelete,
}: {
  title: string
  addLabel: string
  items: ReferenceItem[]
  selectedId: string | null
  canUpdate: boolean
  canAdd: boolean
  addDisabledHint?: string
  emptyHint: string
  showCascadeHint?: boolean
  onAdd: () => void
  onSelect: (id: string) => void
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
                showCascadeHint={showCascadeHint}
                canUpdate={canUpdate}
                onSelect={onSelect}
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
