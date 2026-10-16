import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SheetEntityToolbar } from '@/components/shared/SheetEntityToolbar'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  runSheetFormSave,
  useSheetDirty,
} from '@/components/ui/sheet'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { ServiceTemplateFields } from './CreateServiceTemplateDialog'
import {
  useDeleteServiceTemplate,
  useUpdateOrderServiceLineForOrder,
  useUpdateServiceTemplate,
} from '../hooks/use-services'
import { serviceTemplateFormSchema, type ServiceTemplateFormValues } from '../schemas'
import type { OrderServiceLine, ServiceTemplate } from '../services/services-service'

export type ServiceOrderLineContext = Pick<
  OrderServiceLine,
  'id' | 'orderId' | 'name' | 'description' | 'unitPrice'
>

type EditServiceTemplateDialogProps = {
  item: ServiceTemplate | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Если открыто из заказа — доступны две кнопки сохранения. */
  orderLine?: ServiceOrderLineContext | null
  /** После локального сохранения (в т.ч. для ещё не сохранённой строки черновика). */
  onSavedForOrder?: (values: ServiceTemplateFormValues) => void
  /** После сохранения шаблона — синхронизировать черновик состава. */
  onSavedToCatalog?: (values: ServiceTemplateFormValues) => void
}

export function EditServiceTemplateDialog({
  item,
  open,
  onOpenChange,
  orderLine = null,
  onSavedForOrder,
  onSavedToCatalog,
}: EditServiceTemplateDialogProps) {
  if (!item) {
    return null
  }

  return (
    <EditServiceTemplateForm
      key={`${item.id}:${orderLine?.id ?? 'catalog'}`}
      item={item}
      open={open}
      onOpenChange={onOpenChange}
      orderLine={orderLine}
      onSavedForOrder={onSavedForOrder}
      onSavedToCatalog={onSavedToCatalog}
    />
  )
}

function EditServiceTemplateForm({
  item,
  open,
  onOpenChange,
  orderLine,
  onSavedForOrder,
  onSavedToCatalog,
}: {
  item: ServiceTemplate
  open: boolean
  onOpenChange: (open: boolean) => void
  orderLine: ServiceOrderLineContext | null
  onSavedForOrder?: (values: ServiceTemplateFormValues) => void
  onSavedToCatalog?: (values: ServiceTemplateFormValues) => void
}) {
  const canEditCatalog = useHasPermission(Permission.SettingsUpdate)
  const canEditOrder = useHasPermission(Permission.OrdersUpdate)
  const updateCatalog = useUpdateServiceTemplate(item.id)
  const updateOrderLine = useUpdateOrderServiceLineForOrder(orderLine?.orderId ?? '')
  const remove = useDeleteServiceTemplate()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const fromOrder = Boolean(orderLine)
  const form = useForm<ServiceTemplateFormValues>({
    resolver: zodResolver(serviceTemplateFormSchema),
    defaultValues: {
      name: orderLine?.name ?? item.name,
      description: orderLine?.description ?? item.description,
      unitPrice: orderLine?.unitPrice ?? item.unitPrice,
    },
  })

  const dirty = form.formState.isDirty
  const saving = updateCatalog.isPending || updateOrderLine.isPending

  async function persistCatalog(values: ServiceTemplateFormValues) {
    await updateCatalog.mutateAsync({ ...values, isActive: item.isActive })
    onSavedToCatalog?.(values)
    toast.success('Сохранено в справочнике')
    form.reset(values)
    if (fromOrder) {
      onOpenChange(false)
    }
  }

  async function persistForOrder(values: ServiceTemplateFormValues) {
    if (!orderLine) {
      return
    }
    if (orderLine.id) {
      await updateOrderLine.mutateAsync({
        lineId: orderLine.id,
        name: values.name,
        description: values.description,
        unitPrice: values.unitPrice,
      })
    }
    onSavedForOrder?.(values)
    toast.success(orderLine.id ? 'Сохранено только для этого заказа' : 'Изменения только в этом заказе')
    form.reset(values)
    onOpenChange(false)
  }

  useSheetDirty(dirty, () =>
    runSheetFormSave(
      form.handleSubmit,
      fromOrder && canEditOrder ? persistForOrder : persistCatalog,
    ),
  )

  async function handleDelete() {
    try {
      await remove.mutateAsync(item.id)
      toast.success('Услуга удалена')
      setDeleteOpen(false)
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  function resetForm() {
    form.reset({
      name: orderLine?.name ?? item.name,
      description: orderLine?.description ?? item.description,
      unitPrice: orderLine?.unitPrice ?? item.unitPrice,
    })
  }

  return (
    <Sheet
      open={open}
      dirty={dirty}
      onOpenChange={(next) => {
        if (!next) {
          resetForm()
        }
        onOpenChange(next)
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col overflow-y-auto sm:max-w-lg"
        actions={
          <SheetEntityToolbar
            onDelete={canEditCatalog && !fromOrder ? () => setDeleteOpen(true) : undefined}
          />
        }
      >
        <SheetHeader className="pr-14">
          <SheetTitle>Услуга</SheetTitle>
          <SheetDescription>
            {fromOrder
              ? 'Только для заказа — эта строка. В справочнике — шаблон и все заказы с этой услугой.'
              : 'Изменения обновляют шаблон и все строки заказов, где эта услуга из справочника.'}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={form.handleSubmit((values) => {
              const save = fromOrder && canEditOrder ? persistForOrder : persistCatalog
              void save(values).catch((error) => toast.error(getErrorMessage(error)))
            })}
            noValidate
          >
            <ServiceTemplateFields form={form} />
            <SheetFooter className="px-0">
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  Закрыть
                </Button>
              </SheetClose>
              {fromOrder ? (
                <>
                  {canEditCatalog ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving || !dirty}
                      onClick={() => {
                        void form.handleSubmit((values) =>
                          persistCatalog(values).catch((error) => toast.error(getErrorMessage(error))),
                        )()
                      }}
                    >
                      {updateCatalog.isPending ? 'Сохранение…' : 'Сохранить в справочнике'}
                    </Button>
                  ) : null}
                  <Button type="submit" disabled={!canEditOrder || saving || !dirty}>
                    {updateOrderLine.isPending ? 'Сохранение…' : 'Сохранить только для заказа'}
                  </Button>
                </>
              ) : (
                <Button type="submit" disabled={!canEditCatalog || saving || !dirty}>
                  {updateCatalog.isPending ? 'Сохранение…' : 'Сохранить'}
                </Button>
              )}
            </SheetFooter>
          </form>
        </Form>
        <ConfirmDialog
          open={deleteOpen}
          title="Удалить услугу"
          description={`«${item.name}» будет удалена. Если она есть в заказах, удаление не пройдёт.`}
          confirmLabel="Удалить"
          isPending={remove.isPending}
          onOpenChange={setDeleteOpen}
          onConfirm={() => void handleDelete()}
        />
      </SheetContent>
    </Sheet>
  )
}
