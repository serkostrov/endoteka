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
  runSheetFormSave,
  useSheetDirty,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/lib/errors'

import { useCreateServiceTemplate } from '../hooks/use-services'
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
  initialQuery?: string
}

export function CreateServiceTemplateDialog({
  open,
  onOpenChange,
  onCreated,
  initialQuery = '',
}: CreateServiceTemplateDialogProps) {
  const create = useCreateServiceTemplate()
  const form = useForm<ServiceTemplateFormValues>({
    resolver: zodResolver(serviceTemplateFormSchema),
    defaultValues: emptyServiceTemplateFormValues,
  })
  useSheetDirty(form.formState.isDirty, () => runSheetFormSave(form.handleSubmit, persist))

  useEffect(() => {
    if (!open) {
      return
    }
    form.reset({
      ...emptyServiceTemplateFormValues,
      name: initialQuery.trim(),
    })
  }, [form, initialQuery, open])

  async function persist(values: ServiceTemplateFormValues) {
    const id = await create.mutateAsync(values)
    toast.success('Услуга создана')
    form.reset(emptyServiceTemplateFormValues)
    onOpenChange(false)
    onCreated?.({
      id,
      name: values.name,
      description: values.description,
      unitPrice: values.unitPrice,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <Sheet
      open={open}
      dirty={form.formState.isDirty}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(emptyServiceTemplateFormValues)
        }
        onOpenChange(next)
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Новая услуга</SheetTitle>
          <SheetDescription>Шаблон появится в поиске состава работы и в настройках.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={form.handleSubmit((values) => {
              void persist(values).catch((error) => {
                const message = getErrorMessage(error)
                form.setError('name', { message })
                toast.error(message)
              })
            })}
            noValidate
          >
            <ServiceTemplateFields form={form} />
            <SheetFooter className="px-0">
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  Отмена
                </Button>
              </SheetClose>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Сохранение…' : 'Создать'}
              </Button>
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
