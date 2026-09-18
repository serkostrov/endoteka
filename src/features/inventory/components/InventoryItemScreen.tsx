import { useMemo, useState, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'

import { useOpenEntitySheet } from '@/app/sheet-stack'
import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { InlineTextInput } from '@/components/shared/InlineTextInput'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { SheetEntityToolbar } from '@/components/shared/SheetEntityToolbar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SupplierLink } from '@/components/shared/SupplierLink'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetDirty,
  runSheetFormSave,
  useSheetExitPresence,
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
  INVENTORY_SEARCH_DEBOUNCE_MS,
  InventoryCountSeedMode,
  inventoryMovementTypeLabels,
  isInventoryMovementType,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { queryKeys } from '@/lib/query-keys'
import { formatDate, formatDateTime } from '@/lib/utils/date'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { ItemFields } from './ItemFields'
import { ItemLabelPrintButton } from './ItemLabelPrintButton'
import { ItemMediaLabel, ItemMediaLabelReadonly } from './ItemMediaLabel'
import {
  useCreateInventoryCount,
  useDeleteInventoryItem,
  useInventoryItemCard,
  useInventoryNameMatches,
  useUpdateInventoryItem,
} from '../hooks/use-inventory'
import { inventoryItemFormSchema, type InventoryItemFormValues } from '../schemas'
import {
  isInventoryDuplicateError,
  type InventoryBatch,
  type InventoryItem,
  type InventoryMovement,
} from '../services/inventory-service'

export function InventoryItemSheet({
  itemId,
  open,
  onOpenChange,
}: {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Сохранено для совместимости: правка по клику, без режима редактирования. */
  initialEditing?: boolean
}) {
  const presence = useSheetExitPresence(open, itemId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? (
        <InventoryItemSheetContent
          key={presence.id}
          itemId={presence.id}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Sheet>
  )
}

function InventoryItemSheetContent({
  itemId,
  onClose,
}: {
  itemId: string
  onClose: () => void
}) {
  const cardQuery = useInventoryItemCard(itemId)
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const remove = useDeleteInventoryItem()

  async function handleDelete() {
    try {
      await remove.mutateAsync(itemId)
      toast.success('Позиция удалена')
      setDeleteOpen(false)
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const item = cardQuery.data?.item

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(96vw,44rem)]"
      onOpenAutoFocus={(event) => event.preventDefault()}
      actions={
        item ? (
          <SheetEntityToolbar
            leading={<ItemLabelPrintButton itemId={item.id} />}
            onDelete={canReceive ? () => setDeleteOpen(true) : undefined}
          />
        ) : null
      }
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Позиция склада</SheetTitle>
        <SheetDescription>Карточка, цены и дополнительные поля номенклатуры.</SheetDescription>
      </SheetHeader>
      <div className="space-y-4 p-4 pr-14">
        {cardQuery.isLoading ? (
          <LoadingState label="Загрузка позиции" className="min-h-40" />
        ) : cardQuery.error ? (
          <ErrorState description={getErrorMessage(cardQuery.error)} />
        ) : !cardQuery.data ? (
          <ErrorState description="Позиция не найдена." />
        ) : (
          <ItemCardBody
            item={cardQuery.data.item}
            batches={cardQuery.data.batches}
            movements={cardQuery.data.movements}
            variant="sheet"
            onDeleted={onClose}
            hideChromeDelete
          />
        )}
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title="Удалить позицию"
        description={
          item
            ? `${item.name} будет удалена. Если по ней есть партии, движения или документы, удаление не пройдёт.`
            : ''
        }
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />
    </SheetContent>
  )
}

function ItemCardBody({
  item,
  batches,
  movements,
  variant,
  onDeleted,
  hideChromeDelete = false,
}: {
  item: InventoryItem
  batches: InventoryBatch[]
  movements: InventoryMovement[]
  variant: 'page' | 'sheet'
  onDeleted?: () => void
  hideChromeDelete?: boolean
}) {
  const navigate = useNavigate()
  const openSheet = useOpenEntitySheet()
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const canCreateSale = useHasPermission(Permission.SalesCreate)
  const canCount = useHasPermission(Permission.InventoryCount)
  const createSale = useCreateSale()
  const createCount = useCreateInventoryCount()
  const remove = useDeleteInventoryItem()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const sortedBatches = useMemo(
    () =>
      [...batches].sort((a, b) => {
        const byDate = b.receiptDate.localeCompare(a.receiptDate)
        if (byDate !== 0) {
          return byDate
        }
        return b.createdAt.localeCompare(a.createdAt)
      }),
    [batches],
  )

  async function handleDelete() {
    try {
      await remove.mutateAsync(item.id)
      toast.success('Позиция удалена')
      setDeleteOpen(false)
      if (onDeleted) {
        onDeleted()
      } else {
        navigate(routes.inventory)
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const codeArticleLine = [
    item.code ? `С/Н: ${item.code}` : null,
    item.article ? `Артикул: ${item.article}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const stockQty = Math.max(0, item.stockQuantity)
  const stockLine = `остаток ${formatQuantity(stockQty)} ${item.unitName}`
  const stockEmpty = item.stockQuantity <= 0

  const actionButtons = (
    <>
      {canCreateSale ? (
        <Button
          type="button"
          variant="outline"
          disabled={createSale.isPending}
          onClick={() => {
            createSale.mutate(
              { seedItemId: item.id },
              {
                onSuccess: (saleId) => openSheet('sale', saleId),
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
          disabled={createCount.isPending}
          onClick={() => {
            createCount.mutate(
              { seedMode: InventoryCountSeedMode.Empty, seedItemId: item.id },
              {
                onSuccess: (countId) => openSheet('count', countId),
                onError: (error) => toast.error(getErrorMessage(error)),
              },
            )
          }}
        >
          Инвентаризация
        </Button>
      ) : null}
    </>
  )

  const actionsRow = (
    <div className="flex flex-wrap items-center gap-2">
      <span
        aria-label={stockLine}
        className={
          stockEmpty
            ? 'inline-flex h-9 items-center rounded-md border border-destructive/30 bg-destructive/10 px-3 text-sm font-medium tabular-nums text-destructive'
            : 'inline-flex h-9 items-center rounded-md border border-border bg-secondary px-3 text-sm font-medium tabular-nums text-secondary-foreground'
        }
      >
        {stockLine}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {actionButtons}
        {variant === 'page' && canReceive && !hideChromeDelete ? (
          <IconActionButton
            label="Удалить"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
          </IconActionButton>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {canReceive ? (
        <ItemCardEditor item={item} variant={variant} actionsRow={actionsRow} />
      ) : (
        <>
          {variant === 'page' ? (
            <div className="space-y-3">
              <PageHeader title={item.name} description={codeArticleLine} />
              {actionsRow}
            </div>
          ) : (
            <div className="space-y-3 pr-2">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight">{item.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{codeArticleLine}</p>
              </div>
              {actionsRow}
            </div>
          )}
          <ItemDataSection item={item} />
        </>
      )}

      <ItemFieldsSection itemId={item.id} canEdit={canReceive} />

      <SectionCard
        title="Остаток по партиям"
        description="Списание со склада — с самых ранних."
      >
        <DataTable
          caption="Партии"
          dense
          framed={false}
          maxVisibleRows={5}
          data={sortedBatches}
          getRowId={(row) => row.id}
          emptyTitle="Партий нет"
          emptyDescription="Появятся после прихода или положительной инвентаризации."
          rowClassName={(row) => (row.remainingQuantity <= 0 ? 'text-muted-foreground' : undefined)}
          columns={[
            {
              id: 'date',
              header: 'Дата',
              className: 'w-[6.5rem]',
              cell: (row) => formatDate(row.receiptDate),
            },
            {
              id: 'supplier',
              header: 'Поставщик',
              cell: (row) => <SupplierLink name={row.supplier} customerId={row.supplierId} />,
            },
            {
              id: 'qty',
              header: 'Пришло',
              className: 'w-[4.5rem] text-right tabular-nums',
              cell: (row) => formatQuantity(row.quantity),
            },
            {
              id: 'left',
              header: 'Остаток',
              className: 'w-[4.5rem] text-right tabular-nums',
              cell: (row) => (
                <span className={row.remainingQuantity <= 0 ? undefined : 'font-medium'}>
                  {formatQuantity(row.remainingQuantity)}
                </span>
              ),
            },
            {
              id: 'price',
              header: 'Цена',
              className: 'w-[5rem] text-right tabular-nums',
              cell: (row) => formatMoney(row.purchasePrice),
            },
          ]}
        />
      </SectionCard>

      {variant === 'page' ? (
        <SectionCard title="Движения" description="Журнал нельзя править. Каждая запись указывает, куда ушёл товар.">
          <DataTable
            caption="Движения"
            dense
            framed={false}
            data={movements}
            getRowId={(row) => row.id}
            emptyTitle="Движений нет"
            onRowClick={(row) => {
              if (row.referenceType === 'order') {
                openSheet('order', row.referenceId)
              }
              if (row.referenceType === 'sale') {
                openSheet('sale', row.referenceId)
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

function ItemCardEditor({
  item,
  variant,
  actionsRow,
}: {
  item: InventoryItem
  variant: 'page' | 'sheet'
  actionsRow: ReactNode
}) {
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
  const watchedName = form.watch('name')
  const debouncedName = useDebouncedValue(watchedName.trim(), INVENTORY_SEARCH_DEBOUNCE_MS)
  const matchesQuery = useInventoryNameMatches(debouncedName, item.id)
  const matches = matchesQuery.data ?? []

  useSheetDirty(form.formState.isDirty, () =>
    runSheetFormSave(form.handleSubmit, async (values) => {
      await update.mutateAsync(values)
      form.reset(values)
      toast.success('Позиция сохранена')
    }),
  )

  async function onSubmit(values: InventoryItemFormValues) {
    try {
      await update.mutateAsync(values)
      form.reset(values)
      toast.success('Позиция сохранена')
    } catch (error) {
      if (isInventoryDuplicateError(error)) {
        form.setError('name', { message: error.message })
        return
      }
      toast.error(getErrorMessage(error))
    }
  }

  const titleField = (
    <FormField
      control={form.control}
      name="name"
      render={({ field }) => (
        <FormItem className="min-w-0 gap-0.5">
          <FormControl>
            <InlineTextInput
              {...field}
              fit="fill"
              aria-label="Наименование"
              placeholder="Наименование"
              className="text-lg font-semibold tracking-tight text-foreground md:text-lg"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  const codeArticleFields = (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      <FormField
        control={form.control}
        name="code"
        render={({ field }) => (
          <FormItem className="!flex max-w-full flex-row flex-wrap items-baseline gap-1 space-y-0">
            <span className="shrink-0 select-none">SN:</span>
            <FormControl>
              <InlineTextInput
                {...field}
                aria-label="Код"
                placeholder="—"
                className="text-sm text-muted-foreground md:text-sm"
              />
            </FormControl>
            <FormMessage className="basis-full" />
          </FormItem>
        )}
      />
      <span className="shrink-0 select-none" aria-hidden>
        ·
      </span>
      <FormField
        control={form.control}
        name="article"
        render={({ field }) => (
          <FormItem className="!flex max-w-full flex-row flex-wrap items-baseline gap-1 space-y-0">
            <span className="shrink-0 select-none">Артикул:</span>
            <FormControl>
              <InlineTextInput
                {...field}
                aria-label="Артикул"
                placeholder="—"
                className="text-sm text-muted-foreground md:text-sm"
              />
            </FormControl>
            <FormMessage className="basis-full" />
          </FormItem>
        )}
      />
    </div>
  )

  const headerBlock = (
    <div className="space-y-3 pr-2">
      <div className="min-w-0 space-y-1">
        {titleField}
        {codeArticleFields}
      </div>
      {actionsRow}
    </div>
  )

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {variant === 'page' ? (
          <div className="space-y-3">
            <PageHeader title={titleField} className="mb-0" />
            <div className="min-w-0 pl-9">{codeArticleFields}</div>
            {actionsRow}
          </div>
        ) : (
          headerBlock
        )}

        {matches.length > 0 ? (
          <Alert>
            <AlertTitle>Такое наименование уже в справочнике</AlertTitle>
            <AlertDescription>
              <ul className="space-y-1">
                {matches.map((match) => (
                  <li key={match.id}>
                    <EntitySheetLink kind="item" id={match.id}>
                      Открыть {match.name}
                      {match.code ? ` (${match.code})` : ''}
                    </EntitySheetLink>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <SectionCard>
          <div className="space-y-4">
            <ItemMediaLabel item={item} form={form} canEdit />
            <ItemFields form={form} excludeItemId={item.id} hideName hideCodeArticle hideBarcode layout="card" />
          </div>
        </SectionCard>
      </form>
    </Form>
  )
}

function ItemDataSection({ item }: { item: InventoryItem }) {
  return (
    <SectionCard>
      <div className="space-y-4">
        <ItemMediaLabelReadonly item={item} />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Категория" value={item.categoryName} />
          <Info label="Единица" value={item.unitName} />
          <Info label="Закупка" value={formatMoney(item.purchasePrice)} />
          <Info label="Ремонт" value={formatMoney(item.repairPrice)} />
          <Info label="Розница" value={formatMoney(item.retailPrice)} />
        </dl>
      </div>
    </SectionCard>
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
  const [extraDraft, setExtraDraft] = useState<Record<string, DynamicFieldValueData> | null>(null)
  const extraValues = extraDraft ?? valuesQuery.data ?? {}
  useSheetDirty(canEdit && extraDraft !== null, extraDraft ? () => saveExtra() : undefined)

  if (activeFields.length === 0) {
    return null
  }

  async function saveExtra() {
    try {
      await saveDynamicFieldValues(FieldEntity.Inventory, itemId, extraValues)
      setExtraDraft(null)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fields.values(FieldEntity.Inventory, itemId),
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
                setExtraDraft((current) => ({ ...(current ?? valuesQuery.data ?? {}), [field.code]: value }))
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
