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
import { useDeleteServiceTemplate, useUpdateServiceTemplate } from '../hooks/use-services'
import { serviceTemplateFormSchema, type ServiceTemplateFormValues } from '../schemas'
import type { ServiceTemplate } from '../services/services-service'

type EditServiceTemplateDialogProps = {
  item: ServiceTemplate | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditServiceTemplateDialog({ item, open, onOpenChange }: EditServiceTemplateDialogProps) {
  if (!item) {
    return null
  }

  return <EditServiceTemplateForm key={item.id} item={item} open={open} onOpenChange={onOpenChange} />
}

function EditServiceTemplateForm({
  item,
  open,
  onOpenChange,
}: {
  item: ServiceTemplate
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const canEdit = useHasPermission(Permission.SettingsUpdate)
  const update = useUpdateServiceTemplate(item.id)
  const remove = useDeleteServiceTemplate()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const form = useForm<ServiceTemplateFormValues>({
    resolver: zodResolver(serviceTemplateFormSchema),
    defaultValues: {
      name: item.name,
      description: item.description,
      unitPrice: item.unitPrice,
    },
  })
  useSheetDirty(form.formState.isDirty, () => runSheetFormSave(form.handleSubmit, persist))

  async function persist(values: ServiceTemplateFormValues) {
    await update.mutateAsync({ ...values, isActive: item.isActive })
    toast.success('Сохранено')
    form.reset(values)
  }

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

  return (
    <Sheet
      open={open}
      dirty={form.formState.isDirty}
      onOpenChange={(next) => {
        if (!next) {
          form.reset({
            name: item.name,
            description: item.description,
            unitPrice: item.unitPrice,
          })
        }
        onOpenChange(next)
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col overflow-y-auto sm:max-w-lg"
        actions={<SheetEntityToolbar onDelete={canEdit ? () => setDeleteOpen(true) : undefined} />}
      >
        <SheetHeader className="pr-14">
          <SheetTitle>Услуга</SheetTitle>
          <SheetDescription>Изменения шаблона не меняют уже добавленные в заказы строки.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={form.handleSubmit((values) => {
              void persist(values).catch((error) => toast.error(getErrorMessage(error)))
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
              <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
                {update.isPending ? 'Сохранение…' : 'Сохранить'}
              </Button>
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
