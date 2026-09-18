import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { Path, UseFormReturn } from 'react-hook-form'

import { SearchCreateAction } from '@/components/shared/SearchSuggestOverlay'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useHasPermission } from '@/features/auth'
import { ReferenceItemDialog } from '@/features/references/components/ReferenceItemDialog'
import {
  useReferenceItemsBySetCode,
  useReferenceSets,
  useUpsertReferenceItem,
} from '@/features/references/hooks/use-references'
import type { ReferenceItemFormValues } from '@/features/references/schemas'
import { Permission } from '@/lib/constants/permissions'
import { ReferenceSetCode } from '@/lib/constants/references'
import { uniqueCode } from '@/lib/utils/code'
import { cn } from '@/lib/utils'

import type { DeviceClassificationFormValues, EditDeviceFormValues } from '../schemas'
import { CLASSIFICATION_NONE } from '../classification'

type RefItem = { id: string; name: string; isActive: boolean; parentId: string | null; code?: string }

type ClassificationField = keyof DeviceClassificationFormValues

type DeviceClassificationFieldsProps = {
  form: UseFormReturn<DeviceClassificationFormValues> | UseFormReturn<EditDeviceFormValues>
  disabled?: boolean
  /** all — полная сетка; title — тип/производитель/модель (название); modification — только модификация */
  parts?: 'all' | 'title' | 'modification'
  /** form — обычные селекты; header — название в шапке */
  appearance?: 'form' | 'header'
}

const NONE_LABEL = 'Не указано'

const headerTriggerClass =
  'h-auto min-h-[1.45em] w-auto justify-start gap-1 rounded-[2px] border-0 bg-transparent px-1 py-0.5 shadow-none ' +
  'text-base font-semibold hover:bg-muted/25 focus-visible:border-0 focus-visible:ring-0 ' +
  'data-[size=default]:h-auto md:text-base [&_svg]:size-3.5 [&_svg]:opacity-40'

const FIELD_META: Record<
  ClassificationField,
  {
    setCode: ReferenceSetCode
    setName: string
    label: string
    requiresParent: boolean
    parentLabel: string | null
  }
> = {
  groupId: {
    setCode: ReferenceSetCode.DeviceGroups,
    setName: 'Тип прибора',
    label: 'Тип прибора',
    requiresParent: false,
    parentLabel: null,
  },
  brandId: {
    setCode: ReferenceSetCode.DeviceBrands,
    setName: 'Производитель',
    label: 'Производитель',
    requiresParent: true,
    parentLabel: 'Тип прибора',
  },
  modelId: {
    setCode: ReferenceSetCode.DeviceModels,
    setName: 'Модель',
    label: 'Модель',
    requiresParent: true,
    parentLabel: 'Производитель',
  },
  modificationId: {
    setCode: ReferenceSetCode.DeviceModifications,
    setName: 'Модификация',
    label: 'Модификация',
    requiresParent: true,
    parentLabel: 'Модель',
  },
}

export function DeviceClassificationFields({
  form: formProp,
  disabled = false,
  parts = 'all',
  appearance = 'form',
}: DeviceClassificationFieldsProps) {
  const form = formProp as UseFormReturn<DeviceClassificationFormValues>
  const canCreate = useHasPermission(Permission.SettingsUpdate)
  const setsQuery = useReferenceSets()
  const groups = useReferenceItemsBySetCode(ReferenceSetCode.DeviceGroups)
  const brands = useReferenceItemsBySetCode(ReferenceSetCode.DeviceBrands)
  const models = useReferenceItemsBySetCode(ReferenceSetCode.DeviceModels)
  const modifications = useReferenceItemsBySetCode(ReferenceSetCode.DeviceModifications)

  const groupId = form.watch('groupId')
  const brandId = form.watch('brandId')
  const modelId = form.watch('modelId')
  const modificationId = form.watch('modificationId')

  const [createField, setCreateField] = useState<ClassificationField | null>(null)

  const brandOptions = ensureSelectedOption(
    (brands.data ?? []).filter((item) => {
      if (!item.isActive) {
        return false
      }
      if (groupId === CLASSIFICATION_NONE) {
        return !item.parentId
      }
      return item.parentId === groupId || !item.parentId
    }),
    brands.data,
    brandId,
  )
  const modelOptions = ensureSelectedOption(
    (models.data ?? []).filter((item) => {
      if (!item.isActive) {
        return false
      }
      return brandId === CLASSIFICATION_NONE ? !item.parentId : item.parentId === brandId
    }),
    models.data,
    modelId,
  )
  const modificationOptions = ensureSelectedOption(
    (modifications.data ?? []).filter((item) => {
      if (!item.isActive) {
        return false
      }
      return modelId === CLASSIFICATION_NONE ? !item.parentId : item.parentId === modelId
    }),
    modifications.data,
    modificationId,
  )

  const showTitle = parts === 'all' || parts === 'title'
  const showModification = parts === 'all' || parts === 'modification'
  const header = appearance === 'header'
  const triggerClass = header ? headerTriggerClass : 'w-full'
  const triggerSlot = header ? 'inline-select-trigger' : undefined

  const createMeta = createField ? FIELD_META[createField] : null
  const createSetId = useMemo(() => {
    if (!createMeta) {
      return ''
    }
    return setsQuery.data?.find((set) => set.code === createMeta.setCode)?.id ?? ''
  }, [createMeta, setsQuery.data])

  const createParentId =
    createField === 'brandId'
      ? groupId !== CLASSIFICATION_NONE
        ? groupId
        : ''
      : createField === 'modelId'
        ? brandId !== CLASSIFICATION_NONE
          ? brandId
          : ''
        : createField === 'modificationId'
          ? modelId !== CLASSIFICATION_NONE
            ? modelId
            : ''
          : ''

  const createParentOptions =
    createField === 'brandId'
      ? (groups.data ?? []).filter((item) => item.isActive || item.id === createParentId)
      : createField === 'modelId'
        ? (brands.data ?? []).filter((item) => item.isActive || item.id === createParentId)
        : createField === 'modificationId'
          ? (models.data ?? []).filter((item) => item.isActive || item.id === createParentId)
          : []

  const createSiblings =
    createField === 'groupId'
      ? (groups.data ?? [])
      : createField === 'brandId'
        ? (brands.data ?? []).filter(
            (item) => item.parentId === createParentId || (!item.parentId && Boolean(createParentId)),
          )
        : createField === 'modelId'
          ? (models.data ?? []).filter((item) => item.parentId === createParentId)
          : createField === 'modificationId'
            ? (modifications.data ?? []).filter(
                (item) =>
                  item.parentId === createParentId || (!item.parentId && Boolean(createParentId)),
              )
            : []

  const save = useUpsertReferenceItem(createSetId)

  function applyCreated(field: ClassificationField, id: string) {
    form.setValue(field, id, { shouldDirty: true, shouldValidate: true })
    if (field === 'groupId') {
      form.setValue('brandId', CLASSIFICATION_NONE)
      form.setValue('modelId', CLASSIFICATION_NONE)
      form.setValue('modificationId', CLASSIFICATION_NONE)
    } else if (field === 'brandId') {
      form.setValue('modelId', CLASSIFICATION_NONE)
      form.setValue('modificationId', CLASSIFICATION_NONE)
    } else if (field === 'modelId') {
      form.setValue('modificationId', CLASSIFICATION_NONE)
    }
  }

  return (
    <>
      <div
        className={cn(
          header
            ? 'flex flex-wrap items-baseline gap-2'
            : parts === 'modification'
              ? 'min-w-0'
              : 'grid gap-3 sm:grid-cols-2',
        )}
      >
        {showTitle ? (
          <>
            <RefSelect
              form={form}
              name="groupId"
              label="Тип прибора"
              disabled={disabled}
              items={(groups.data ?? []).filter((item) => item.isActive)}
              triggerClassName={triggerClass}
              triggerSlot={triggerSlot}
              hideLabel={header}
              allowCreate={canCreate}
              onCreate={() => setCreateField('groupId')}
              onValueChange={() => {
                form.setValue('brandId', CLASSIFICATION_NONE)
                form.setValue('modelId', CLASSIFICATION_NONE)
                form.setValue('modificationId', CLASSIFICATION_NONE)
              }}
            />
            <RefSelect
              form={form}
              name="brandId"
              label="Производитель"
              disabled={disabled || groupId === CLASSIFICATION_NONE}
              items={brandOptions}
              triggerClassName={triggerClass}
              triggerSlot={triggerSlot}
              hideLabel={header}
              allowCreate={canCreate && groupId !== CLASSIFICATION_NONE}
              onCreate={() => setCreateField('brandId')}
              onValueChange={() => {
                form.setValue('modelId', CLASSIFICATION_NONE)
                form.setValue('modificationId', CLASSIFICATION_NONE)
              }}
            />
            <RefSelect
              form={form}
              name="modelId"
              label="Модель"
              disabled={disabled || brandId === CLASSIFICATION_NONE}
              items={modelOptions}
              triggerClassName={triggerClass}
              triggerSlot={triggerSlot}
              hideLabel={header}
              allowCreate={canCreate && brandId !== CLASSIFICATION_NONE}
              onCreate={() => setCreateField('modelId')}
              onValueChange={() => form.setValue('modificationId', CLASSIFICATION_NONE)}
            />
          </>
        ) : null}
        {showModification ? (
          <RefSelect
            form={form}
            name="modificationId"
            label="Модификация"
            disabled={disabled || modelId === CLASSIFICATION_NONE}
            items={modificationOptions}
            allowCreate={canCreate && modelId !== CLASSIFICATION_NONE}
            onCreate={() => setCreateField('modificationId')}
          />
        ) : null}
      </div>

      {createField && createMeta && createSetId ? (
        <ReferenceItemDialog
          open
          setName={createMeta.setName}
          requiresParent={createMeta.requiresParent}
          parentLabel={createMeta.parentLabel}
          parentOptions={createParentOptions}
          item={null}
          defaultParentId={createParentId}
          lockParent={createMeta.requiresParent && Boolean(createParentId)}
          isPending={save.isPending}
          onOpenChange={(open) => {
            if (!open) {
              setCreateField(null)
            }
          }}
          onSubmit={async (values: ReferenceItemFormValues) => {
            const id = await save.mutateAsync({
              setId: createSetId,
              code: uniqueCode(
                values.name,
                createSiblings.map((row) => row.code ?? ''),
              ),
              name: values.name,
              description: values.description,
              parentId: createMeta.requiresParent ? createParentId || values.parentId || null : null,
            })
            applyCreated(createField, id)
            toast.success('Запись добавлена')
            setCreateField(null)
          }}
        />
      ) : null}
    </>
  )
}

function ensureSelectedOption(
  options: RefItem[],
  all: RefItem[] | undefined,
  selectedId: string,
): RefItem[] {
  if (!selectedId || selectedId === CLASSIFICATION_NONE) {
    return options
  }
  if (options.some((item) => item.id === selectedId)) {
    return options
  }
  const current = all?.find((item) => item.id === selectedId)
  return current ? [current, ...options] : options
}

function matchesQuery(name: string, query: string) {
  const term = query.trim().toLowerCase()
  if (!term) {
    return true
  }
  return name.toLowerCase().includes(term)
}

function RefSelect({
  form,
  name,
  label,
  items,
  disabled,
  onValueChange,
  triggerClassName,
  triggerSlot,
  hideLabel = false,
  allowCreate = false,
  onCreate,
}: {
  form: UseFormReturn<DeviceClassificationFormValues>
  name: ClassificationField
  label: string
  items: { id: string; name: string }[]
  disabled?: boolean
  onValueChange?: () => void
  triggerClassName?: string
  triggerSlot?: string
  hideLabel?: boolean
  allowCreate?: boolean
  onCreate?: () => void
}) {
  const listId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  return (
    <FormField
      control={form.control}
      name={name as Path<DeviceClassificationFormValues>}
      render={({ field }) => {
        const value = field.value || CLASSIFICATION_NONE
        const selectedLabel =
          value === CLASSIFICATION_NONE
            ? NONE_LABEL
            : (items.find((item) => item.id === value)?.name ?? NONE_LABEL)
        const filtered = items.filter((item) => matchesQuery(item.name, query))
        const showNone = matchesQuery(NONE_LABEL, query)

        function pick(next: string) {
          field.onChange(next)
          onValueChange?.()
          setOpen(false)
        }

        return (
          <FormItem className={cn('gap-1.5', hideLabel && 'w-fit')}>
            {hideLabel ? (
              <FormLabel className="sr-only">{label}</FormLabel>
            ) : (
              <FormLabel>{label}</FormLabel>
            )}
            <Popover
              open={open}
              onOpenChange={(next) => {
                if (disabled) {
                  return
                }
                setOpen(next)
              }}
            >
              <PopoverTrigger asChild>
                <FormControl>
                  <button
                    type="button"
                    data-slot={triggerSlot}
                    disabled={disabled}
                    aria-label={label}
                    aria-expanded={open}
                    aria-controls={listId}
                    className={cn(
                      'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-muted px-3 py-0 text-left text-sm shadow-xs outline-none',
                      'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-50',
                      triggerClassName,
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
                    <ChevronDown />
                  </button>
                </FormControl>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={4}
                className="z-[80] w-[var(--radix-popover-trigger-width)] min-w-[12rem] max-w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden p-0"
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <div className="border-b p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Поиск…"
                      className="h-8 pl-8"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.stopPropagation()
                          setOpen(false)
                        }
                      }}
                    />
                  </div>
                </div>
                <div id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto p-1">
                  {showNone ? (
                    <OptionButton
                      selected={value === CLASSIFICATION_NONE}
                      onSelect={() => pick(CLASSIFICATION_NONE)}
                    >
                      {NONE_LABEL}
                    </OptionButton>
                  ) : null}
                  {filtered.map((item) => (
                    <OptionButton
                      key={item.id}
                      selected={value === item.id}
                      onSelect={() => pick(item.id)}
                    >
                      {item.name}
                    </OptionButton>
                  ))}
                  {!showNone && filtered.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">Ничего не найдено</p>
                  ) : null}
                </div>
                {allowCreate ? (
                  <SearchCreateAction
                    label="Новый"
                    onCreate={() => {
                      setOpen(false)
                      onCreate?.()
                    }}
                  />
                ) : null}
              </PopoverContent>
            </Popover>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}

function OptionButton({
  selected,
  onSelect,
  children,
}: {
  selected: boolean
  onSelect: () => void
  children: string
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        'relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-left text-sm outline-hidden select-none',
        'hover:bg-accent hover:text-accent-foreground',
        selected && 'bg-accent text-accent-foreground',
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected ? <Check className="absolute right-2 size-4" /> : null}
    </button>
  )
}
