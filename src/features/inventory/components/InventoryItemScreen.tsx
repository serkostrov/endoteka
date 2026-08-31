import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetDirty,
  runSheetFormSave,
} from '@/components/ui/sheet'
import { DynamicFieldRenderer, DynamicFieldValue, DynamicFieldsGrid, saveDynamicFieldValues } from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { useHasPermission } from '@/features/auth'
import { useCreateSale } from '@/features/sales/hooks/use-sales'
import { FieldEntity, fieldLayoutWidthClass } from '@/lib/constants/fields'
import {
  formatMoney,
  formatQuantity,
  InventoryCountSeedMode,
  inventoryMovementTypeLabels,
  isInventoryMovementType,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { formatDate, formatDateTime } from '@/lib/utils/date'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { ItemFields } from './ItemFields'
import { useCreateInventoryCount, useDeleteInventoryItem, useInventoryItemCard, useUpdateInventoryItem } from '../hooks/use-inventory'
import { inventoryItemFormSchema, type InventoryItemFormValues } from '../schemas'
import {
  isInventoryDuplicateError,
  type InventoryBatch,
  type InventoryItem,
  type InventoryMovement,
} from '../services/inventory-service'

export function InventoryItemScreen() {
  const { id } = useParams()
  return <InventoryItemView itemId={id} variant="page" />
}

export function InventoryItemSheet({
  itemId,
  open,
  onOpenChange,
}: {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="sr-only">
          <SheetTitle>Позиция склада</SheetTitle>
          <SheetDescription>Карточка, цены и дополнительные поля номенклатуры.</SheetDescription>
        </SheetHeader>
        {open && itemId ? (
          <div className="p-4 pr-12">
            <InventoryItemView key={itemId} itemId={itemId} variant="sheet" />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function InventoryItemView({
  itemId,
  variant,
}: {
  itemId: string | undefined
  variant: 'page' | 'sheet'
}) {
  const cardQuery = useInventoryItemCard(itemId)

  if (cardQuery.isLoading) {
    return <LoadingState label="Загрузка позиции" className={variant === 'sheet' ? 'min-h-40' : undefined} />
  }

  if (cardQuery.error) {
    return <ErrorState description={getErrorMessage(cardQuery.error)} />
  }

  const card = cardQuery.data
  if (!card) {
    return <ErrorState description="Позиция не найдена." />
  }

  return <ItemCardBody item={card.item} batches={card.batches} movements={card.movements} variant={variant} />
}

function ItemCardBody({
  item,
  batches,
  movements,
  variant,
}: {
  item: InventoryItem
  batches: InventoryBatch[]
  movements: InventoryMovement[]
  variant: 'page' | 'sheet'
}) {
  const navigate = useNavigate()
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const canCreateSale = useHasPermission(Permission.SalesCreate)
  const canCount = useHasPermission(Permission.InventoryCount)
  const createSale = useCreateSale()
  const createCount = useCreateInventoryCount()
  const remove = useDeleteInventoryItem()
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function handleDelete() {
    try {
      await remove.mutateAsync(item.id)
      toast.success('Позиция удалена')
      setDeleteOpen(false)
      navigate(routes.inventory)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const subtitle = `${item.code}${item.article ? ` · ${item.article}` : ''} · остаток ${formatQuantity(item.stockQuantity)} ${item.unitName}`

  return (
    <div className="space-y-4">
      {variant === 'page' ? (
        <PageHeader
          title={item.name}
          description={subtitle}
          actions={
            <div className="flex flex-wrap gap-2">
              {canCreateSale ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={createSale.isPending}
                  onClick={() => {
                    createSale.mutate(
                      { seedItemId: item.id },
                      {
                        onSuccess: (saleId) => navigate(routes.sale.replace(':id', saleId)),
                        onError: (error) => toast.error(getErrorMessage(error)),
                      },
                    )
                  }}
                >
                  Продажа
                </Button>
              ) : null}
              {canCount ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={createCount.isPending}
                  onClick={() => {
                    createCount.mutate(
                      { seedMode: InventoryCountSeedMode.Empty, seedItemId: item.id },
                      {
                        onSuccess: (countId) => navigate(routes.inventoryCount.replace(':id', countId)),
                        onError: (error) => toast.error(getErrorMessage(error)),
                      },
                    )
                  }}
                >
                  Инвентаризация
                </Button>
              ) : null}
              {canReceive ? (
                <IconActionButton
                  label="Удалить"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 />
                </IconActionButton>
              ) : null}
            </div>
          }
        />
      ) : (
        <div className="pr-2">
          <h2 className="text-lg font-semibold tracking-tight">{item.name}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
        </div>
      )}

      <ItemDataSection item={item} canEdit={canReceive} />
      <ItemFieldsSection itemId={item.id} canEdit={canReceive} />

      <SectionCard title="Остаток по партиям" description="Списание: сначала самые ранние поступления.">
        <DataTable
          caption="Партии"
          data={batches}
          getRowId={(row) => row.id}
          emptyTitle="Партий нет"
          emptyDescription="Появятся после прихода или положительной инвентаризации."
          columns={[
            { id: 'date', header: 'Дата', cell: (row) => formatDate(row.receiptDate) },
            { id: 'supplier', header: 'Поставщик', cell: (row) => row.supplier || '—' },
            { id: 'qty', header: 'Пришло', cell: (row) => formatQuantity(row.quantity) },
            { id: 'left', header: 'Остаток', cell: (row) => formatQuantity(row.remainingQuantity) },
            { id: 'price', header: 'Цена партии', cell: (row) => formatMoney(row.purchasePrice) },
          ]}
        />
      </SectionCard>

      {variant === 'page' ? (
      <SectionCard title="Движения" description="Журнал нельзя править. Каждая запись указывает, куда ушёл товар.">
        <DataTable
          caption="Движения"
          data={movements}
          getRowId={(row) => row.id}
          emptyTitle="Движений нет"
          onRowClick={(row) => {
            if (row.referenceType === 'order') {
              navigate(routes.order.replace(':id', row.referenceId))
            }
            if (row.referenceType === 'sale') {
              navigate(routes.sale.replace(':id', row.referenceId))
            }
          }}
          columns={[
            { id: 'when', header: 'Когда', cell: (row) => formatDateTime(row.createdAt) },
            {
              id: 'type',
              header: 'Тип',
              cell: (row) => (
                <StatusBadge tone={row.quantity < 0 ? 'warning' : 'success'}>
                  {isInventoryMovementType(row.movementType)
                    ? inventoryMovementTypeLabels[row.movementType]
                    : row.movementType}
                </StatusBadge>
              ),
            },
            {
              id: 'qty',
              header: 'Кол-во',
              cell: (row) => formatQuantity(row.quantity),
            },
            { id: 'price', header: 'Цена', cell: (row) => formatMoney(row.unitPrice) },
            { id: 'dest', header: 'Куда', cell: (row) => row.destination || '—' },
            {
              id: 'user',
              header: 'Кто',
              className: 'hidden md:table-cell',
              cell: (row) => row.actorName || '—',
            },
          ]}
        />
      </SectionCard>
      ) : null}

      {variant === 'page' ? (
        <ConfirmDialog
          open={deleteOpen}
          title="Удалить позицию"
          description={`${item.name} будет удалена. Если по ней есть партии, движения или документы, удаление не пройдёт.`}
          confirmLabel="Удалить"
          isPending={remove.isPending}
          onOpenChange={setDeleteOpen}
          onConfirm={() => void handleDelete()}
        />
      ) : null}
    </div>
  )
}

function ItemDataSection({ item, canEdit }: { item: InventoryItem; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)

  return (
    <SectionCard
      title="Карточка"
      description={editing ? 'Цены справочника не меняют уже оприходованные партии.' : undefined}
      actions={
        canEdit && !editing ? (
          <IconActionButton label="Редактировать" onClick={() => setEditing(true)}>
            <Pencil />
          </IconActionButton>
        ) : null
      }
    >
      {editing ? (
        <ItemEditForm item={item} onDone={() => setEditing(false)} />
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Info label="Наименование" value={item.name} />
          </div>
          <Info label="Код" value={item.code} />
          <Info label="Артикул" value={item.article} />
          <Info label="Штрихкод" value={item.barcode} />
          <Info label="Категория" value={item.categoryName} />
          <Info label="Единица" value={item.unitName} />
          <Info label="Закупка" value={formatMoney(item.purchasePrice)} />
          <Info label="Ремонт" value={formatMoney(item.repairPrice)} />
          <Info label="Розница" value={formatMoney(item.retailPrice)} />
        </dl>
      )}
    </SectionCard>
  )
}

function ItemEditForm({ item, onDone }: { item: InventoryItem; onDone: () => void }) {
  const update = useUpdateInventoryItem(item.id)
  const form = useForm<InventoryItemFormValues>({
    resolver: zodResolver(inventoryItemFormSchema),
    defaultValues: {
      name: item.name,
      code: item.code,
      article: item.article,
      barcode: item.barcode,
      categoryId: item.categoryId,
      unitId: item.unitId,
      purchasePrice: item.purchasePrice,
      repairPrice: item.repairPrice,
      retailPrice: item.retailPrice,
    },
  })
  useSheetDirty(form.formState.isDirty, () =>
    runSheetFormSave(form.handleSubmit, async (values) => {
      await update.mutateAsync(values)
      toast.success('Позиция сохранена')
    }),
  )

  async function onSubmit(values: InventoryItemFormValues) {
    try {
      await update.mutateAsync(values)
      toast.success('Позиция сохранена')
      onDone()
    } catch (error) {
      if (isInventoryDuplicateError(error)) {
        form.setError('name', { message: error.message })
        return
      }
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <ItemFields form={form} excludeItemId={item.id} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Отмена
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Form>
  )
}

function ItemFieldsSection({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const fieldsQuery = useDynamicFields(FieldEntity.Inventory)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Inventory, itemId)
  const queryClient = useQueryClient()
  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const [editing, setEditing] = useState(false)
  const [extraDraft, setExtraDraft] = useState<Record<string, DynamicFieldValueData> | null>(null)
  const extraValues = extraDraft ?? valuesQuery.data ?? {}
  const [saving, setSaving] = useState(false)
  useSheetDirty(editing && extraDraft !== null, extraDraft ? () => saveExtra() : undefined)

  if (activeFields.length === 0) {
    return null
  }

  function cancelEdit() {
    setExtraDraft(null)
    setEditing(false)
  }

  async function saveExtra() {
    setSaving(true)
    try {
      await saveDynamicFieldValues(FieldEntity.Inventory, itemId, extraValues)
      setExtraDraft(null)
      setEditing(false)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fields.values(FieldEntity.Inventory, itemId),
      })
      toast.success('Поля сохранены')
    } catch (error) {
      toast.error(getErrorMessage(error))
      throw error
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Дополнительные поля"
      actions={
        canEdit && !editing ? (
          <IconActionButton label="Редактировать" onClick={() => setEditing(true)}>
            <Pencil />
          </IconActionButton>
        ) : null
      }
    >
      {editing ? (
        <>
          <DynamicFieldsGrid>
            {activeFields.map((field) => (
              <DynamicFieldRenderer
                key={field.id}
                field={field}
                value={extraValues[field.code] ?? emptyFieldValue(field)}
                onChange={(value) =>
                  setExtraDraft((current) => ({ ...(current ?? valuesQuery.data ?? {}), [field.code]: value }))
                }
              />
            ))}
          </DynamicFieldsGrid>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
              Отмена
            </Button>
            <Button type="button" onClick={() => void saveExtra()} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </>
      ) : (
        <dl className="grid grid-cols-12 gap-3 text-sm">
          {activeFields.map((field) => (
            <div key={field.id} className={fieldLayoutWidthClass(field)}>
              <dt className="text-muted-foreground">{field.name}</dt>
              <dd className="mt-0.5 font-medium">
                <DynamicFieldValue field={field} value={extraValues[field.code] ?? emptyFieldValue(field)} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </SectionCard>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value || '—'}</dd>
    </div>
  )
}
