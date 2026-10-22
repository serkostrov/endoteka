import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Briefcase, Trash2, Wrench } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useHasPermission } from '@/features/auth'
import {
  DynamicFieldRenderer,
  DynamicFieldValue,
  DynamicFieldsGrid,
  groupDynamicFields,
} from '@/features/dynamic-fields'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import type { DynamicFieldDefinition } from '@/features/dynamic-fields/services/fields-service'
import { InventoryItemSheet } from '@/features/inventory/components/InventoryItemScreen'
import { useOrderInventoryUsage } from '@/features/inventory/hooks/use-inventory'
import { FieldEntity, fieldLayoutWidthClass } from '@/lib/constants/fields'
import { formatMoney, formatQuantity, parseQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { ServiceTemplateSheet } from './ServiceTemplateSheet'
import { useOrderServiceLines } from '../hooks/use-services'
import {
  useOrderWorkCompositionDraft,
  type WorkDraftLine,
} from '../lib/order-work-composition-draft'

type ActorGroup = {
  actorName: string
  lines: WorkDraftLine[]
}

const cellPad = 'px-2 py-1.5'
const spinless =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const customPartSchema = z.object({
  name: z.string().trim().min(1, 'Укажите наименование'),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  quantity: z.number().int('Количество должно быть целым числом').positive('Количество должно быть больше нуля'),
})

const customServiceSchema = z.object({
  name: z.string().trim().min(1, 'Укажите наименование'),
  description: z.string().trim(),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  quantity: z.number().int('Количество должно быть целым числом').positive('Количество должно быть больше нуля'),
})

type CustomPartFormValues = z.infer<typeof customPartSchema>
type CustomServiceFormValues = z.infer<typeof customServiceSchema>

function isOrderOnlyLine(line: WorkDraftLine) {
  return line.kind === 'part' ? !line.itemId : !line.templateId
}

export function OrderWorkCompositionTable({ orderId }: { orderId: string }) {
  const canWriteOff = useHasPermission(Permission.InventoryWriteOff)
  const canUpdateServices = useHasPermission(Permission.OrdersUpdate)
  const workDraft = useOrderWorkCompositionDraft()
  const partsQuery = useOrderInventoryUsage(orderId)
  const servicesQuery = useOrderServiceLines(orderId)
  const fieldsQuery = useDynamicFields(FieldEntity.OrderWork)
  const [openedItemId, setOpenedItemId] = useState<string | null>(null)
  const [openedCatalogService, setOpenedCatalogService] = useState<WorkDraftLine | null>(null)
  const [customPart, setCustomPart] = useState<WorkDraftLine | null>(null)
  const [customService, setCustomService] = useState<WorkDraftLine | null>(null)

  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const isLoading = partsQuery.isLoading || servicesQuery.isLoading || fieldsQuery.isLoading
  const error = partsQuery.error ?? servicesQuery.error ?? fieldsQuery.error

  const groups = useMemo(() => groupDraftLines(workDraft.visibleLines), [workDraft.visibleLines])
  const hasLines = groups.length > 0
  const hasFields = activeFields.length > 0

  if (error) {
    return (
      <ErrorState
        description={getErrorMessage(error)}
        onRetry={() => {
          void partsQuery.refetch()
          void servicesQuery.refetch()
          void fieldsQuery.refetch()
        }}
        className="py-6"
      />
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-1.5" aria-busy="true">
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4">
        {hasLines ? (
          <div className="overflow-x-auto">
            <Table className="table-fixed">
              <colgroup>
                <col style={{ width: '2rem' }} />
                <col />
                <col style={{ width: '7.5rem' }} />
                <col style={{ width: '6.5rem' }} />
                <col style={{ width: '7.5rem' }} />
                <col style={{ width: '2rem' }} />
              </colgroup>
              <TableHeader>
                <TableRow className="border-b hover:bg-transparent">
                  <TableHead className={cn(cellPad, 'h-8')} aria-hidden />
                  <TableHead className={cn(cellPad, 'h-8 text-xs font-medium text-muted-foreground')}>
                    Наименование
                  </TableHead>
                  <TableHead
                    className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}
                  >
                    Цена, ₽
                  </TableHead>
                  <TableHead
                    className={cn(
                      cellPad,
                      'h-8 pr-5 text-right text-xs font-medium text-muted-foreground',
                    )}
                  >
                    Кол-во
                  </TableHead>
                  <TableHead
                    className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}
                  >
                    Сумма, ₽
                  </TableHead>
                  <TableHead className={cn(cellPad, 'h-8')} aria-hidden />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <ActorGroupRows
                    key={group.actorName}
                    group={group}
                    canWriteOff={canWriteOff}
                    canUpdateServices={canUpdateServices}
                    onOpenPart={(itemId) => setOpenedItemId(itemId)}
                    onOpenCatalogService={(line) => setOpenedCatalogService(line)}
                    onOpenCustomPart={(line) => setCustomPart(line)}
                    onOpenCustomService={(line) => setCustomService(line)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title="Состав работ пока пуст"
            description="Добавьте работу, услугу или товар через поиск выше."
            className="border-dashed bg-muted/20 py-10"
          />
        )}

        {hasFields ? (
          <WorkCompositionFields
            orderId={orderId}
            fields={activeFields}
            canEdit={canUpdateServices}
          />
        ) : null}
      </div>

      <InventoryItemSheet
        itemId={openedItemId}
        open={Boolean(openedItemId)}
        onOpenChange={(open) => {
          if (!open) {
            setOpenedItemId(null)
          }
        }}
      />
      <ServiceTemplateSheet
        templateId={openedCatalogService?.templateId ?? null}
        open={Boolean(openedCatalogService?.templateId)}
        orderLine={
          openedCatalogService
            ? {
                id: openedCatalogService.serverId ?? '',
                orderId,
                name: openedCatalogService.name,
                description: openedCatalogService.description,
                unitPrice: openedCatalogService.unitPrice,
              }
            : null
        }
        onSavedForOrder={(values) => {
          if (!openedCatalogService) {
            return
          }
          // Уже сохранённая строка без черновика: API сам обновил заказ, draft не трогаем.
          if (openedCatalogService.serverId && !workDraft.dirty) {
            return
          }
          workDraft.updateLine(openedCatalogService.key, {
            name: values.name,
            description: values.description,
            unitPrice: values.unitPrice,
            templateId: null,
          })
        }}
        onSavedToCatalog={(values) => {
          const templateId = openedCatalogService?.templateId
          if (!templateId || !workDraft.dirty) {
            return
          }
          for (const line of workDraft.lines) {
            if (line.kind === 'service' && line.templateId === templateId && !line.deleted) {
              workDraft.updateLine(line.key, {
                name: values.name,
                description: values.description,
                unitPrice: values.unitPrice,
              })
            }
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setOpenedCatalogService(null)
          }
        }}
      />
      <EditCustomPartDialog
        line={customPart}
        open={Boolean(customPart)}
        onOpenChange={(open) => {
          if (!open) {
            setCustomPart(null)
          }
        }}
      />
      <EditCustomServiceDialog
        line={customService}
        open={Boolean(customService)}
        onOpenChange={(open) => {
          if (!open) {
            setCustomService(null)
          }
        }}
      />
    </>
  )
}

function WorkCompositionFields({
  orderId,
  fields,
  canEdit,
}: {
  orderId: string
  fields: DynamicFieldDefinition[]
  canEdit: boolean
}) {
  const workDraft = useOrderWorkCompositionDraft()
  const { bindFields, fieldValues, fieldErrors, setFieldValue } = workDraft
  const valuesQuery = useDynamicFieldValues(FieldEntity.OrderWork, orderId)
  const fieldGroups = useMemo(() => groupDynamicFields(fields), [fields])

  useEffect(() => {
    if (!valuesQuery.isSuccess) {
      return
    }
    bindFields(fields, valuesQuery.data ?? {})
  }, [bindFields, fields, valuesQuery.data, valuesQuery.isSuccess])

  if (valuesQuery.isLoading) {
    return (
      <div className="space-y-1.5" aria-busy="true">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-20 w-full rounded-md" />
        <Skeleton className="h-20 w-full rounded-md" />
      </div>
    )
  }

  if (valuesQuery.error) {
    return (
      <ErrorState
        description={getErrorMessage(valuesQuery.error)}
        onRetry={() => void valuesQuery.refetch()}
        className="py-4"
      />
    )
  }

  return (
    <div className="space-y-3">
      {fieldGroups.map((group) => (
        <SectionCard key={group.name} title={group.name} flat>
          <DynamicFieldsGrid className="gap-x-4 gap-y-3">
            {group.fields.map((field) =>
              canEdit ? (
                <DynamicFieldRenderer
                  key={field.id}
                  field={field}
                  value={fieldValues[field.code] ?? emptyFieldValue(field)}
                  error={fieldErrors[field.code]}
                  onChange={(value) => setFieldValue(field.code, value, valuesQuery.data ?? {})}
                />
              ) : (
                <div key={field.id} className={cn('space-y-1.5', fieldLayoutWidthClass(field))}>
                  <p className="text-sm text-muted-foreground">
                    {field.name}
                    {field.isRequired ? <span className="text-destructive"> *</span> : null}
                  </p>
                  <p className="text-sm">
                    <DynamicFieldValue
                      field={field}
                      value={fieldValues[field.code] ?? emptyFieldValue(field)}
                    />
                  </p>
                </div>
              ),
            )}
          </DynamicFieldsGrid>
        </SectionCard>
      ))}
    </div>
  )
}

function ActorGroupRows({
  group,
  canWriteOff,
  canUpdateServices,
  onOpenPart,
  onOpenCatalogService,
  onOpenCustomPart,
  onOpenCustomService,
}: {
  group: ActorGroup
  canWriteOff: boolean
  canUpdateServices: boolean
  onOpenPart: (itemId: string) => void
  onOpenCatalogService: (line: WorkDraftLine) => void
  onOpenCustomPart: (line: WorkDraftLine) => void
  onOpenCustomService: (line: WorkDraftLine) => void
}) {
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={6} className="border-b bg-muted/25 px-2.5 py-1.5">
          <p className="text-xs font-semibold tracking-wide text-foreground/80">{group.actorName}</p>
        </TableCell>
      </TableRow>
      {group.lines.map((line) => (
        <WorkLineRow
          key={line.key}
          line={line}
          canEdit={
            line.kind === 'part'
              ? canWriteOff || (canUpdateServices && !line.itemId)
              : canUpdateServices
          }
          onOpen={() => {
            if (line.kind === 'part') {
              if (line.itemId) {
                onOpenPart(line.itemId)
              } else {
                onOpenCustomPart(line)
              }
              return
            }
            if (line.templateId) {
              onOpenCatalogService(line)
            } else {
              onOpenCustomService(line)
            }
          }}
        />
      ))}
    </>
  )
}

function WorkLineRow({
  line,
  canEdit,
  onOpen,
}: {
  line: WorkDraftLine
  canEdit: boolean
  onOpen: () => void
}) {
  const workDraft = useOrderWorkCompositionDraft()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const amount = line.quantity * line.unitPrice
  const TypeIcon = line.kind === 'part' ? Briefcase : Wrench

  function handleRowClick(event: MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, button, a, [data-row-ignore-click]')) {
      return
    }
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      return
    }
    onOpen()
  }

  return (
    <TableRow
      role="link"
      tabIndex={0}
      title="Открыть карточку"
      className="group/row cursor-pointer border-b last:border-b-0 hover:bg-muted/20"
      onClick={handleRowClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <TableCell className={cn(cellPad, 'w-8 text-muted-foreground')}>
        <TypeIcon className="size-3.5 opacity-70" aria-hidden />
        <span className="sr-only">{line.kind === 'part' ? 'Запчасть' : 'Услуга'}</span>
      </TableCell>
      <TableCell className={cn(cellPad, 'max-w-0 whitespace-normal')}>
        <div className="flex min-w-0 max-w-full items-baseline gap-2">
          <span className="select-text truncate text-sm font-medium text-primary" title={line.name}>
            {line.name}
          </span>
          {isOrderOnlyLine(line) ? (
            <StatusBadge tone="neutral" className="shrink-0 text-[10px]">
              Только для заказа
            </StatusBadge>
          ) : null}
          {line.subtitle ? (
            <span className="hidden min-w-0 select-text truncate text-[11px] text-muted-foreground sm:inline">
              {line.subtitle}
            </span>
          ) : null}
        </div>
        {line.subtitle ? (
          <p className="mt-0.5 select-text truncate text-[11px] text-muted-foreground sm:hidden">
            {line.subtitle}
          </p>
        ) : null}
      </TableCell>
      <TableCell className={cn(cellPad, 'whitespace-nowrap text-right')}>
        <InlineNumberField line={line} field="unitPrice" disabled={!canEdit} />
      </TableCell>
      <TableCell className={cn(cellPad, 'whitespace-nowrap text-right')}>
        <InlineNumberField
          line={line}
          field="quantity"
          disabled={!canEdit}
          suffix={line.unitName}
        />
      </TableCell>
      <TableCell className={cn(cellPad, 'whitespace-nowrap text-right text-sm tabular-nums')}>
        {formatMoney(amount)}
      </TableCell>
      <TableCell className={cellPad}>
        {canEdit ? (
          <IconActionButton
            label="Удалить из заказа"
            variant="ghost"
            size="icon-xs"
            className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
            disabled={workDraft.saving}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
          </IconActionButton>
        ) : null}

        <ConfirmDialog
          open={deleteOpen}
          title={line.kind === 'part' ? 'Удалить из состава' : 'Удалить услугу'}
          description={
            line.kind === 'part'
              ? `${line.name} будет убрана из состава. Списание со склада — только после сохранения.`
              : `«${line.name}» будет убрана из состава.`
          }
          confirmLabel="Удалить"
          isPending={false}
          onOpenChange={setDeleteOpen}
          onConfirm={() => {
            workDraft.removeLine(line.key)
            setDeleteOpen(false)
            toast.success(line.kind === 'part' ? 'Позиция убрана из состава' : 'Услуга убрана из состава')
          }}
        />
      </TableCell>
    </TableRow>
  )
}

function EditCustomPartDialog({
  line,
  open,
  onOpenChange,
}: {
  line: WorkDraftLine | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const workDraft = useOrderWorkCompositionDraft()
  const form = useForm<CustomPartFormValues>({
    resolver: zodResolver(customPartSchema),
    defaultValues: { name: '', unitPrice: 0, quantity: 1 },
  })

  useEffect(() => {
    if (!open || !line) {
      return
    }
    form.reset({
      name: line.name,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
    })
  }, [form, open, line])

  if (!line) {
    return null
  }

  const dirty = form.formState.isDirty

  return (
    <Sheet open={open} dirty={dirty} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Позиция заказа</SheetTitle>
          <SheetDescription>
            Позиция только для этого заказа, в справочник не попадает. Изменения применятся после
            сохранения состава.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={form.handleSubmit((values) => {
              if (!form.formState.isDirty) {
                onOpenChange(false)
                return
              }
              workDraft.updateLine(line.key, {
                name: values.name,
                quantity: values.quantity,
                unitPrice: values.unitPrice,
              })
              toast.success('Изменения в составе')
              onOpenChange(false)
            })}
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Наименование
                    <StatusBadge tone="neutral" className="text-[10px] font-normal">
                      Только для заказа
                    </StatusBadge>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="unitPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Цена</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="tabular-nums"
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(event) => field.onChange(Number(event.target.value))}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Количество</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step="1"
                        className="tabular-nums"
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(event) => field.onChange(Number(event.target.value))}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <SheetFooter className="px-0">
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  {dirty ? 'Отмена' : 'Закрыть'}
                </Button>
              </SheetClose>
              {dirty ? (
                <Button type="submit">Готово</Button>
              ) : null}
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

function EditCustomServiceDialog({
  line,
  open,
  onOpenChange,
}: {
  line: WorkDraftLine | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const workDraft = useOrderWorkCompositionDraft()
  const form = useForm<CustomServiceFormValues>({
    resolver: zodResolver(customServiceSchema),
    defaultValues: { name: '', description: '', unitPrice: 0, quantity: 1 },
  })

  useEffect(() => {
    if (!open || !line) {
      return
    }
    form.reset({
      name: line.name,
      description: line.description,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
    })
  }, [form, open, line])

  if (!line) {
    return null
  }

  const dirty = form.formState.isDirty

  return (
    <Sheet open={open} dirty={dirty} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Услуга заказа</SheetTitle>
          <SheetDescription>
            Услуга только для этого заказа, в справочник не попадает. Изменения применятся после
            сохранения состава.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={form.handleSubmit((values) => {
              if (!form.formState.isDirty) {
                onOpenChange(false)
                return
              }
              workDraft.updateLine(line.key, {
                name: values.name,
                description: values.description,
                quantity: values.quantity,
                unitPrice: values.unitPrice,
              })
              toast.success('Изменения в составе')
              onOpenChange(false)
            })}
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Наименование
                    <StatusBadge tone="neutral" className="text-[10px] font-normal">
                      Только для заказа
                    </StatusBadge>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Описание</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={1}
                      placeholder="Необязательно"
                      className="field-sizing-content min-h-9 max-h-32 resize-none overflow-y-auto py-1.5 leading-5"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="unitPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Цена</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="tabular-nums"
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(event) => field.onChange(Number(event.target.value))}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Количество</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step="1"
                        className="tabular-nums"
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(event) => field.onChange(Number(event.target.value))}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <SheetFooter className="px-0">
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  {dirty ? 'Отмена' : 'Закрыть'}
                </Button>
              </SheetClose>
              {dirty ? (
                <Button type="submit">Готово</Button>
              ) : null}
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

function InlineNumberField({
  line,
  field,
  disabled,
  suffix,
}: {
  line: WorkDraftLine
  field: 'quantity' | 'unitPrice'
  disabled: boolean
  suffix?: string
}) {
  const workDraft = useOrderWorkCompositionDraft()
  const current = field === 'quantity' ? line.quantity : line.unitPrice
  const isQty = field === 'quantity'
  const stockCap =
    isQty && line.kind === 'part' && line.itemId != null && line.stockQuantity != null
      ? Math.max(
          1,
          Math.round(line.stockQuantity) + (line.serverId ? Math.round(line.baseline?.quantity ?? 0) : 0),
        )
      : null

  const [draft, setDraft] = useState(String(current))
  const [flash, setFlash] = useState(false)
  const draftRef = useRef(draft)
  const flashTimer = useRef<number | null>(null)
  draftRef.current = draft

  useEffect(() => {
    setDraft(String(current))
  }, [current, line.key])

  useEffect(() => {
    return () => {
      if (flashTimer.current != null) {
        window.clearTimeout(flashTimer.current)
      }
    }
  }, [])

  function flashCap() {
    setFlash(false)
    requestAnimationFrame(() => {
      setFlash(true)
      if (flashTimer.current != null) {
        window.clearTimeout(flashTimer.current)
      }
      flashTimer.current = window.setTimeout(() => setFlash(false), 550)
    })
  }

  function applyQuantity(raw: string, persist: boolean) {
    if (!persist && raw.trim() === '') {
      setDraft(raw)
      return
    }

    const parsed = parseQuantity(raw)
    if (parsed == null) {
      if (persist) {
        toast.error('Количество должно быть целым числом')
        setDraft(String(current))
      } else {
        setDraft(raw)
      }
      return
    }
    if (parsed <= 0) {
      if (persist) {
        toast.error('Количество должно быть больше нуля')
        setDraft(String(current))
      } else {
        setDraft(raw)
      }
      return
    }

    let next = parsed
    if (stockCap != null && next > stockCap) {
      next = stockCap
      setDraft(String(next))
      flashCap()
    } else {
      setDraft(String(next))
    }

    if (!persist || next === current) {
      return
    }
    workDraft.updateLine(line.key, { quantity: next })
  }

  function commitPrice(raw: string) {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed === current) {
      return
    }
    if (parsed < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }
    workDraft.updateLine(line.key, { unitPrice: parsed })
  }

  if (isQty) {
    return (
      <div className="inline-flex w-full items-center justify-end gap-1">
        {disabled ? (
          <span className="min-w-[2.25rem] text-right text-sm tabular-nums text-foreground">
            {formatQuantity(current)}
          </span>
        ) : (
          <Input
            type="number"
            min={1}
            max={stockCap ?? undefined}
            step="1"
            aria-label="Количество"
            className={cn(
              spinless,
              'h-7 w-[2.75rem] shrink-0 border-transparent bg-transparent px-0.5 text-right text-sm shadow-none tabular-nums',
              'hover:border-border hover:bg-background',
              'focus-visible:border-input focus-visible:bg-background focus-visible:ring-1',
              flash && 'animate-stock-cap',
            )}
            value={draft}
            disabled={workDraft.saving}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onFocus={(event) => event.target.select()}
            onChange={(event) => applyQuantity(event.target.value, false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            onBlur={() => applyQuantity(draftRef.current, true)}
          />
        )}
        <span className="w-8 shrink-0 text-left text-[11px] leading-none text-muted-foreground">
          {suffix || 'шт'}
        </span>
      </div>
    )
  }

  if (disabled) {
    return (
      <span className="block whitespace-nowrap text-right text-sm tabular-nums text-foreground">
        {formatMoney(current)}
      </span>
    )
  }

  return (
    <Input
      key={`${line.key}-${field}-${current}`}
      type="number"
      min={0}
      step="0.01"
      aria-label="Цена"
      className={cn(
        spinless,
        'ml-auto h-7 w-full min-w-[6.5rem] max-w-[8rem] border-transparent bg-transparent px-1.5 text-right text-sm shadow-none tabular-nums',
        'hover:border-border hover:bg-background',
        'focus-visible:border-input focus-visible:bg-background focus-visible:ring-1',
      )}
      defaultValue={current}
      disabled={workDraft.saving}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
      onBlur={(event) => commitPrice(event.target.value)}
    />
  )
}

function groupDraftLines(lines: WorkDraftLine[]): ActorGroup[] {
  const byActor = new Map<string, WorkDraftLine[]>()
  for (const line of lines) {
    const bucket = byActor.get(line.actorName) ?? []
    bucket.push(line)
    byActor.set(line.actorName, bucket)
  }

  return [...byActor.entries()]
    .map(([actorName, actorLines]) => ({
      actorName,
      lines: actorLines.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .sort((a, b) => a.actorName.localeCompare(b.actorName, 'ru'))
}
