import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'

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
  markNestedDialogClosing,
  shouldIgnoreNestedDialogClose,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/lib/errors'

import { useAddOrderCustomServiceLine, useCreateServiceTemplate } from '../hooks/use-services'
import {
  emptyServiceTemplateFormValues,
  serviceTemplateFormSchema,
  type ServiceTemplateFormValues,
} from '../schemas'
import type { ServiceTemplate } from '../services/services-service'

type CreateServiceTemplateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (item: ServiceTemplate) => void
  /** Если задан — можно создать строку только в этот заказ, без справочника. */
  orderId?: string
  onCreatedForOrder?: () => void
  initialQuery?: string
}

export function CreateServiceTemplateDialog({
  open,
  onOpenChange,
  onCreated,
  orderId,
  onCreatedForOrder,
  initialQuery = '',
}: CreateServiceTemplateDialogProps) {
  const create = useCreateServiceTemplate()
  const addCustom = useAddOrderCustomServiceLine(orderId ?? '')
  const form = useForm<ServiceTemplateFormValues>({
    resolver: zodResolver(serviceTemplateFormSchema),
    defaultValues: emptyServiceTemplateFormValues,
  })
  const canSaveCatalog = Boolean(onCreated) || !orderId

  useEffect(() => {
    if (!open) {
      return
    }
    form.reset({
      ...emptyServiceTemplateFormValues,
      name: initialQuery.trim(),
    })
  }, [form, initialQuery, open])

  function closeOnly() {
    form.reset(emptyServiceTemplateFormValues)
    markNestedDialogClosing()
    onOpenChange(false)
  }

  async function persistCatalog(values: ServiceTemplateFormValues) {
    const id = await create.mutateAsync(values)
    toast.success('Услуга добавлена в справочник')
    onCreated?.({
      id,
      name: values.name,
      description: values.description,
      unitPrice: values.unitPrice,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    closeOnly()
  }

  async function persistForOrder(values: ServiceTemplateFormValues) {
    if (!orderId) {
      return
    }
    await addCustom.mutateAsync({
      name: values.name,
      description: values.description,
      unitPrice: values.unitPrice,
      quantity: 1,
    })
    toast.success('Услуга добавлена в заказ')
    closeOnly()
    onCreatedForOrder?.()
  }

  const pending = create.isPending || addCustom.isPending

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && shouldIgnoreNestedDialogClose()) {
          return
        }
        if (!next) {
          form.reset(emptyServiceTemplateFormValues)
          markNestedDialogClosing()
        }
        onOpenChange(next)
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Новая услуга</SheetTitle>
          <SheetDescription>
            {orderId
              ? 'Можно добавить только в этот заказ или сохранить шаблон в справочник. Окно заказа останется открытым.'
              : 'Шаблон появится в поиске состава работы и в настройках.'}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.stopPropagation()
              void form.handleSubmit((values) => {
                void (orderId ? persistForOrder(values) : persistCatalog(values)).catch((error) => {
                  const message = getErrorMessage(error)
                  form.setError('name', { message })
                  toast.error(message)
                })
              })(event)
            }}
            noValidate
          >
            <ServiceTemplateFields form={form} />
            <SheetFooter className="px-0">
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  Отмена
                </Button>
              </SheetClose>
              {canSaveCatalog ? (
                <Button
                  type={orderId ? 'button' : 'submit'}
                  variant={orderId ? 'outline' : 'default'}
                  disabled={pending}
                  onClick={
                    orderId
                      ? () => {
                          void form.handleSubmit((values) => {
                            void persistCatalog(values).catch((error) => {
                              const message = getErrorMessage(error)
                              form.setError('name', { message })
                              toast.error(message)
                            })
                          })()
                        }
                      : undefined
                  }
                >
                  {create.isPending
                    ? 'Сохранение…'
                    : orderId
                      ? 'Создать и добавить в справочник'
                      : 'Сохранить'}
                </Button>
              ) : null}
              {orderId ? (
                <Button type="submit" disabled={pending}>
                  {addCustom.isPending ? 'Добавление…' : 'Создать только для заказа'}
                </Button>
              ) : null}
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

export function ServiceTemplateFields({ form }: { form: UseFormReturn<ServiceTemplateFormValues> }) {
  return (
    <>
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
    </>
  )
}
