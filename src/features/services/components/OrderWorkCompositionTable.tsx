import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Briefcase, Trash2, Wrench } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
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
import { InventoryItemSheet } from '@/features/inventory/components/InventoryItemScreen'
import {
  useOrderInventoryUsage,
  useRemoveOrderPartLine,
  useSetOrderPartLine,
  useUpdateOrderCustomPartLine,
} from '@/features/inventory/hooks/use-inventory'
import type { OrderInventoryUsage } from '@/features/inventory/services/inventory-service'
import { useHasPermission } from '@/features/auth'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { ServiceTemplateSheet } from './ServiceTemplateSheet'
import {
  useOrderServiceLines,
  useRemoveOrderServiceLine,
  useSetOrderServiceLine,
  useUpdateOrderCustomServiceLine,
} from '../hooks/use-services'
import type { OrderServiceLine } from '../services/services-service'

type WorkLineKind = 'part' | 'service'

type WorkCompositionLine = {
  key: string
  kind: WorkLineKind
  id: string
  name: string
  subtitle: string
  quantity: number
  unitPrice: number
  unitName: string
  actorName: string
  createdAt: string
  part?: OrderInventoryUsage
  service?: OrderServiceLine
}

type ActorGroup = {
  actorName: string
  lines: WorkCompositionLine[]
}

const cellPad = 'px-2 py-1.5'
const spinless =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const customPartSchema = z.object({
  name: z.string().trim().min(1, 'Укажите наименование'),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  quantity: z.number().positive('Количество должно быть больше нуля'),
})

const customServiceSchema = z.object({
  name: z.string().trim().min(1, 'Укажите наименование'),
  description: z.string().trim(),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  quantity: z.number().positive('Количество должно быть больше нуля'),
})

type CustomPartFormValues = z.infer<typeof customPartSchema>
type CustomServiceFormValues = z.infer<typeof customServiceSchema>

export function OrderWorkCompositionTable({ orderId }: { orderId: string }) {
  const canWriteOff = useHasPermission(Permission.InventoryWriteOff)
  const canUpdateServices = useHasPermission(Permission.OrdersUpdate)
  const partsQuery = useOrderInventoryUsage(orderId)
  const servicesQuery = useOrderServiceLines(orderId)
  const [openedItemId, setOpenedItemId] = useState<string | null>(null)
  const [openedTemplateId, setOpenedTemplateId] = useState<string | null>(null)
  const [customPart, setCustomPart] = useState<OrderInventoryUsage | null>(null)
  const [customService, setCustomService] = useState<OrderServiceLine | null>(null)

  const parts = partsQuery.data ?? []
  const services = servicesQuery.data ?? []
  const isLoading = partsQuery.isLoading || servicesQuery.isLoading
  const error = partsQuery.error ?? servicesQuery.error

  const groups = useMemo(() => groupLines(parts, services), [parts, services])
  const isEmpty = groups.length === 0

  if (error) {
    return (
      <ErrorState
        description={getErrorMessage(error)}
        onRetry={() => {
          void partsQuery.refetch()
          void servicesQuery.refetch()
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

  if (isEmpty) {
    return (
      <EmptyState
        title="Состав работы пуст"
        description="Добавьте запчасть или услугу — они появятся в таблице."
        className="border-0 bg-transparent py-8"
      />
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table className="table-fixed">
          <colgroup>
            <col style={{ width: '2rem' }} />
            <col />
            <col style={{ width: '5.5rem' }} />
            <col style={{ width: '5.75rem' }} />
            <col style={{ width: '5.5rem' }} />
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
                orderId={orderId}
                canWriteOff={canWriteOff}
                canUpdateServices={canUpdateServices}
                onOpenPart={(itemId) => setOpenedItemId(itemId)}
                onOpenService={(templateId) => setOpenedTemplateId(templateId)}
                onOpenCustomPart={(part) => setCustomPart(part)}
                onOpenCustomService={(service) => setCustomService(service)}
              />
            ))}
          </TableBody>
        </Table>
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
        templateId={openedTemplateId}
        open={Boolean(openedTemplateId)}
        onOpenChange={(open) => {
          if (!open) {
            setOpenedTemplateId(null)
          }
        }}
      />
      <EditCustomPartDialog
        orderId={orderId}
        part={customPart}
        open={Boolean(customPart)}
        onOpenChange={(open) => {
          if (!open) {
            setCustomPart(null)
          }
        }}
      />
      <EditCustomServiceDialog
        orderId={orderId}
        service={customService}
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

function ActorGroupRows({
  group,
  orderId,
  canWriteOff,
  canUpdateServices,
  onOpenPart,
  onOpenService,
  onOpenCustomPart,
  onOpenCustomService,
}: {
  group: ActorGroup
  orderId: string
  canWriteOff: boolean
  canUpdateServices: boolean
  onOpenPart: (itemId: string) => void
  onOpenService: (templateId: string) => void
  onOpenCustomPart: (part: OrderInventoryUsage) => void
  onOpenCustomService: (service: OrderServiceLine) => void
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
          orderId={orderId}
          canEdit={
            line.kind === 'part'
              ? canWriteOff || (canUpdateServices && !line.part?.itemId)
              : canUpdateServices
          }
          onOpen={() => {
            if (line.kind === 'part' && line.part) {
              if (line.part.itemId) {
                onOpenPart(line.part.itemId)
              } else {
                onOpenCustomPart(line.part)
              }
              return
            }
            if (line.kind === 'service' && line.service) {
              if (line.service.templateId) {
                onOpenService(line.service.templateId)
              } else {
                onOpenCustomService(line.service)
              }
            }
          }}
        />
      ))}
    </>
  )
}

function WorkLineRow({
  line,
  orderId,
  canEdit,
  onOpen,
}: {
  line: WorkCompositionLine
  orderId: string
  canEdit: boolean
  onOpen: () => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const removePart = useRemoveOrderPartLine(orderId)
  const removeService = useRemoveOrderServiceLine(orderId)
  const removePending = line.kind === 'part' ? removePart.isPending : removeService.isPending
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
      className="group/row cursor-pointer border-b last:border-b-0 hover:bg-muted/20"
      onClick={handleRowClick}
    >
      <TableCell className={cn(cellPad, 'w-8 text-muted-foreground')}>
        <TypeIcon className="size-3.5 opacity-70" aria-hidden />
        <span className="sr-only">{line.kind === 'part' ? 'Запчасть' : 'Услуга'}</span>
      </TableCell>
      <TableCell className={cn(cellPad, 'max-w-0 whitespace-normal')}>
        <div className="flex min-w-0 max-w-full items-baseline gap-2">
          <span className="cursor-text select-text truncate text-sm font-medium text-primary">
            {line.name}
          </span>
          {line.subtitle ? (
            <span className="hidden min-w-0 cursor-text select-text truncate text-[11px] text-muted-foreground sm:inline">
              {line.subtitle}
            </span>
          ) : null}
        </div>
        {line.subtitle ? (
          <p className="mt-0.5 cursor-text select-text truncate text-[11px] text-muted-foreground sm:hidden">
            {line.subtitle}
          </p>
        ) : null}
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right')} data-row-ignore-click>
        <InlineNumberField line={line} orderId={orderId} field="unitPrice" disabled={!canEdit} />
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right')} data-row-ignore-click>
        <InlineNumberField
          line={line}
          orderId={orderId}
          field="quantity"
          disabled={!canEdit}
          suffix={line.unitName}
        />
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right text-sm tabular-nums')}>
        {formatMoney(amount)}
      </TableCell>
      <TableCell className={cellPad} data-row-ignore-click>
        {canEdit ? (
          <IconActionButton
            label="Удалить из заказа"
            variant="ghost"
            size="icon-xs"
            className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
            disabled={removePending}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
          </IconActionButton>
        ) : null}

        <ConfirmDialog
          open={deleteOpen}
          title={line.kind === 'part' ? 'Удалить из заказа' : 'Удалить услугу'}
          description={
            line.kind === 'part'
              ? `${line.name} вернётся на склад.`
              : `«${line.name}» будет убрана из заказа.`
          }
          confirmLabel="Удалить"
          isPending={removePending}
          onOpenChange={setDeleteOpen}
          onConfirm={() => {
            if (line.kind === 'part') {
              removePart.mutate(line.id, {
                onSuccess: () => {
                  setDeleteOpen(false)
                  toast.success('Запчасть удалена из заказа')
                },
                onError: (error) => toast.error(getErrorMessage(error)),
              })
              return
            }
            removeService.mutate(line.id, {
              onSuccess: () => {
                setDeleteOpen(false)
                toast.success('Услуга удалена')
              },
              onError: (error) => toast.error(getErrorMessage(error)),
            })
          }}
        />
      </TableCell>
    </TableRow>
  )
}

function EditCustomPartDialog({
  orderId,
  part,
  open,
  onOpenChange,
}: {
  orderId: string
  part: OrderInventoryUsage | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateOrderCustomPartLine(orderId)
  const form = useForm<CustomPartFormValues>({
    resolver: zodResolver(customPartSchema),
    defaultValues: { name: '', unitPrice: 0, quantity: 1 },
  })

  useEffect(() => {
    if (!open || !part) {
      return
    }
    form.reset({
      name: part.itemName,
      unitPrice: part.unitPrice,
      quantity: part.quantity,
    })
  }, [form, open, part])

  if (!part) {
    return null
  }

  return (
    <Sheet
      open={open}
      dirty={form.formState.isDirty}
      onOpenChange={onOpenChange}
    >
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Позиция заказа</SheetTitle>
          <SheetDescription>Создана только для этого заказа, без справочника.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={form.handleSubmit(async (values) => {
              try {
                await update.mutateAsync({
                  lineId: part.id,
                  name: values.name,
                  quantity: values.quantity,
                  unitPrice: values.unitPrice,
                })
                toast.success('Сохранено')
                onOpenChange(false)
              } catch (error) {
                form.setError('name', { message: getErrorMessage(error) })
              }
            })}
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Наименование</FormLabel>
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
                        min={0.001}
                        step="0.001"
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
                  Отмена
                </Button>
              </SheetClose>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

function EditCustomServiceDialog({
  orderId,
  service,
  open,
  onOpenChange,
}: {
  orderId: string
  service: OrderServiceLine | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateOrderCustomServiceLine(orderId)
  const form = useForm<CustomServiceFormValues>({
    resolver: zodResolver(customServiceSchema),
    defaultValues: { name: '', description: '', unitPrice: 0, quantity: 1 },
  })

  useEffect(() => {
    if (!open || !service) {
      return
    }
    form.reset({
      name: service.name,
      description: service.description,
      unitPrice: service.unitPrice,
      quantity: service.quantity,
    })
  }, [form, open, service])

  if (!service) {
    return null
  }

  return (
    <Sheet
      open={open}
      dirty={form.formState.isDirty}
      onOpenChange={onOpenChange}
    >
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Услуга заказа</SheetTitle>
          <SheetDescription>Создана только для этого заказа, без справочника.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={form.handleSubmit(async (values) => {
              try {
                await update.mutateAsync({
                  lineId: service.id,
                  name: values.name,
                  description: values.description,
                  quantity: values.quantity,
                  unitPrice: values.unitPrice,
                })
                toast.success('Сохранено')
                onOpenChange(false)
              } catch (error) {
                form.setError('name', { message: getErrorMessage(error) })
              }
            })}
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Наименование</FormLabel>
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
                        min={0.001}
                        step="0.001"
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
                  Отмена
                </Button>
              </SheetClose>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

function InlineNumberField({
  line,
  orderId,
  field,
  disabled,
  suffix,
}: {
  line: WorkCompositionLine
  orderId: string
  field: 'quantity' | 'unitPrice'
  disabled: boolean
  suffix?: string
}) {
  const setPart = useSetOrderPartLine(orderId)
  const setService = useSetOrderServiceLine(orderId)
  const setPending = line.kind === 'part' ? setPart.isPending : setService.isPending
  const current = field === 'quantity' ? line.quantity : line.unitPrice
  const isQty = field === 'quantity'

  function commit(raw: string) {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed === current) {
      return
    }
    if (field === 'quantity' && parsed <= 0) {
      toast.error('Количество должно быть больше нуля')
      return
    }
    if (field === 'unitPrice' && parsed < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }

    const payload = {
      lineId: line.id,
      quantity: field === 'quantity' ? parsed : line.quantity,
      unitPrice: field === 'unitPrice' ? parsed : line.unitPrice,
    }

    if (line.kind === 'part') {
      setPart.mutate(payload, { onError: (error) => toast.error(getErrorMessage(error)) })
      return
    }
    setService.mutate(payload, { onError: (error) => toast.error(getErrorMessage(error)) })
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
            key={`${line.key}-${field}-${current}`}
            type="number"
            min={0.001}
            step="0.001"
            aria-label="Количество"
            className={cn(
              spinless,
              'h-7 w-[2.75rem] shrink-0 border-transparent bg-transparent px-0.5 text-right text-sm shadow-none tabular-nums',
              'hover:border-border hover:bg-background',
              'focus-visible:border-input focus-visible:bg-background focus-visible:ring-1',
            )}
            defaultValue={current}
            disabled={setPending}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            onBlur={(event) => commit(event.target.value)}
          />
        )}
        <span className="w-8 shrink-0 text-left text-[11px] leading-none text-muted-foreground">
          {suffix || 'шт'}
        </span>
      </div>
    )
  }

  if (disabled) {
    return <span className="block text-right text-sm tabular-nums text-foreground">{formatMoney(current)}</span>
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
        'ml-auto h-7 w-[4.75rem] border-transparent bg-transparent px-1.5 text-right text-sm shadow-none tabular-nums',
        'hover:border-border hover:bg-background',
        'focus-visible:border-input focus-visible:bg-background focus-visible:ring-1',
      )}
      defaultValue={current}
      disabled={setPending}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
      onBlur={(event) => commit(event.target.value)}
    />
  )
}

function groupLines(parts: OrderInventoryUsage[], services: OrderServiceLine[]): ActorGroup[] {
  const lines: WorkCompositionLine[] = [
    ...parts.map(
      (part): WorkCompositionLine => ({
        key: `part:${part.id}`,
        kind: 'part',
        id: part.id,
        name: part.itemName,
        subtitle: [part.itemCode, part.itemArticle].filter(Boolean).join(' · '),
        quantity: part.quantity,
        unitPrice: part.unitPrice,
        unitName: part.unitName || 'шт',
        actorName: part.actorName.trim() || 'Без исполнителя',
        createdAt: part.createdAt,
        part,
      }),
    ),
    ...services.map(
      (service): WorkCompositionLine => ({
        key: `service:${service.id}`,
        kind: 'service',
        id: service.id,
        name: service.name,
        subtitle: service.description,
        quantity: service.quantity,
        unitPrice: service.unitPrice,
        unitName: 'шт',
        actorName: service.actorName.trim() || 'Без исполнителя',
        createdAt: service.createdAt,
        service,
      }),
    ),
  ]

  const byActor = new Map<string, WorkCompositionLine[]>()
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
