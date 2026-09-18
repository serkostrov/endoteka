import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { UseFormReturn } from 'react-hook-form'

import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { SearchCreateAction } from '@/components/shared/SearchSuggestOverlay'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { markNestedDialogClosing } from '@/components/ui/sheet'
import { useHasPermission } from '@/features/auth'
import {
  ReferenceItemDialog,
  useReferenceItemsBySetCode,
  useReferenceSets,
  useUpsertReferenceItem,
} from '@/features/references'
import type { ReferenceItemFormValues } from '@/features/references/schemas'
import { INVENTORY_SEARCH_DEBOUNCE_MS } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { ReferenceSetCode } from '@/lib/constants/references'
import { uniqueCode } from '@/lib/utils/code'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { useInventoryNameMatches } from '../hooks/use-inventory'
import type { InventoryItemFormValues } from '../schemas'

type ItemFieldsProps = {
  form: UseFormReturn<InventoryItemFormValues>
  disabled?: boolean
  excludeItemId?: string
  /** Скрыть поле наименования — когда оно вынесено в шапку. */
  hideName?: boolean
  /** Скрыть код и артикул — когда они вынесены в шапку. */
  hideCodeArticle?: boolean
  /** Скрыть штрихкод — когда этикетка вынесена рядом с фото. */
  hideBarcode?: boolean
  /** Сетка как в карточке: 2 колонки. */
  layout?: 'form' | 'card'
}

type CreateKind = 'category' | 'unit'

export function ItemFields({
  form,
  disabled = false,
  excludeItemId,
  hideName = false,
  hideCodeArticle = false,
  hideBarcode = false,
  layout = 'form',
}: ItemFieldsProps) {
  const name = form.watch('name')
  const debouncedName = useDebouncedValue(name.trim(), INVENTORY_SEARCH_DEBOUNCE_MS)
  const matchesQuery = useInventoryNameMatches(disabled || hideName ? '' : debouncedName, excludeItemId)
  const matches = matchesQuery.data ?? []
  const categories = useReferenceItemsBySetCode(ReferenceSetCode.InventoryCategories)
  const units = useReferenceItemsBySetCode(ReferenceSetCode.UnitsOfMeasure)
  const setsQuery = useReferenceSets()
  const canCreate = useHasPermission(Permission.SettingsUpdate)
  const [createKind, setCreateKind] = useState<CreateKind | null>(null)

  const categoryOptions = (categories.data ?? []).filter((item) => item.isActive)
  const unitOptions = (units.data ?? []).filter((item) => item.isActive)
  const card = layout === 'card'

  const createSet = useMemo(() => {
    if (!createKind) {
      return null
    }
    const code =
      createKind === 'category' ? ReferenceSetCode.InventoryCategories : ReferenceSetCode.UnitsOfMeasure
    return setsQuery.data?.find((set) => set.code === code) ?? null
  }, [createKind, setsQuery.data])

  const createSiblings =
    createKind === 'category' ? (categories.data ?? []) : createKind === 'unit' ? (units.data ?? []) : []
  const save = useUpsertReferenceItem(createSet?.id ?? '')

  return (
    <div className={cn(card ? 'space-y-3' : 'space-y-4')}>
      {!hideName && matches.length > 0 ? (
        <Alert>
          <AlertTitle>Такое наименование уже в справочнике</AlertTitle>
          <AlertDescription>
            <ul className="space-y-1">
              {matches.map((item) => (
                <li key={item.id}>
                  <EntitySheetLink kind="item" id={item.id}>
                    Открыть {item.name}
                    {item.code ? ` (${item.code})` : ''}
                  </EntitySheetLink>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {!hideName ? (
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Наименование</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      <div className={cn('grid gap-4', card ? 'gap-3 sm:grid-cols-2' : 'sm:grid-cols-3')}>
        {!hideCodeArticle ? (
          <>
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Код</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" disabled={disabled} placeholder="Назначится сам" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="article"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Артикул</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" disabled={disabled} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        ) : null}
        {!hideBarcode ? (
          <FormField
            control={form.control}
            name="barcode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Штрихкод</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="off" inputMode="numeric" disabled={disabled} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        {card ? (
          <>
            <RefSelectField
              form={form}
              name="categoryId"
              label="Категория"
              placeholder="Выберите категорию"
              disabled={disabled}
              options={categoryOptions}
              allowCreate={canCreate}
              onCreate={() => setCreateKind('category')}
            />
            <RefSelectField
              form={form}
              name="unitId"
              label="Единица"
              placeholder="шт или упак"
              disabled={disabled}
              options={unitOptions}
              allowCreate={canCreate}
              onCreate={() => setCreateKind('unit')}
            />
            <PriceField form={form} name="purchasePrice" label="Закупка" disabled={disabled} />
            <PriceField form={form} name="repairPrice" label="Ремонт" disabled={disabled} />
            <PriceField form={form} name="retailPrice" label="Розница" disabled={disabled} />
          </>
        ) : null}
      </div>

      {!card ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <RefSelectField
              form={form}
              name="categoryId"
              label="Категория"
              placeholder="Выберите категорию"
              disabled={disabled}
              options={categoryOptions}
              allowCreate={canCreate}
              onCreate={() => setCreateKind('category')}
            />
            <RefSelectField
              form={form}
              name="unitId"
              label="Единица"
              placeholder="шт или упак"
              disabled={disabled}
              options={unitOptions}
              allowCreate={canCreate}
              onCreate={() => setCreateKind('unit')}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <PriceField form={form} name="purchasePrice" label="Закупка" disabled={disabled} />
            <PriceField form={form} name="repairPrice" label="Ремонт" disabled={disabled} />
            <PriceField form={form} name="retailPrice" label="Розница" disabled={disabled} />
          </div>
        </>
      ) : null}

      {createKind && createSet ? (
        <ReferenceItemDialog
          open
          setName={createSet.name}
          requiresParent={false}
          parentOptions={[]}
          item={null}
          isPending={save.isPending}
          onOpenChange={(open) => {
            if (!open) {
              setCreateKind(null)
            }
          }}
          onSubmit={async (values: ReferenceItemFormValues) => {
            const id = await save.mutateAsync({
              setId: createSet.id,
              code: uniqueCode(
                values.name,
                createSiblings.map((row) => row.code ?? ''),
              ),
              name: values.name,
              description: values.description,
              parentId: null,
            })
            markNestedDialogClosing()
            form.setValue(createKind === 'category' ? 'categoryId' : 'unitId', id, {
              shouldDirty: true,
              shouldValidate: true,
            })
            toast.success(createKind === 'category' ? 'Категория добавлена' : 'Единица добавлена')
          }}
        />
      ) : null}
    </div>
  )
}

function RefSelectField({
  form,
  name,
  label,
  placeholder,
  disabled,
  options,
  allowCreate,
  onCreate,
}: {
  form: UseFormReturn<InventoryItemFormValues>
  name: 'categoryId' | 'unitId'
  label: string
  placeholder: string
  disabled: boolean
  options: { id: string; name: string }[]
  allowCreate: boolean
  onCreate: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            value={field.value}
            disabled={disabled}
            open={open}
            onOpenChange={setOpen}
            onValueChange={field.onChange}
          >
            <FormControl>
              <SelectTrigger className="w-full" aria-label={label}>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
              {allowCreate ? (
                <SearchCreateAction
                  label="Новый"
                  onCreate={() => {
                    setOpen(false)
                    window.setTimeout(() => onCreate(), 0)
                  }}
                />
              ) : null}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function PriceField({
  form,
  name,
  label,
  disabled,
}: {
  form: UseFormReturn<InventoryItemFormValues>
  name: 'purchasePrice' | 'repairPrice' | 'retailPrice'
  label: string
  disabled: boolean
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={0}
              step="0.01"
              disabled={disabled}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value === '' ? 0 : Number(event.target.value))}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
