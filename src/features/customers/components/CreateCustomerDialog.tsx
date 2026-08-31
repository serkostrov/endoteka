import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

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
  useSheetDirty,
  runSheetFormSave,
} from '@/components/ui/sheet'
import { CustomerKind } from '@/lib/constants/customers'
import { getErrorMessage } from '@/lib/errors'

import { CustomerFields } from './CustomerFields'
import { useCreateCustomer } from '../hooks/use-customers'
import { emptyCustomerForm, customerFormSchema, type CustomerFormValues } from '../schemas'
import { getCustomer } from '../services/customers-service'
import type { Customer } from '../services/customers-service'

type CreateCustomerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (customer: Customer) => void
  defaultKind?: CustomerKind
  hideKind?: boolean
  title?: string
  description?: string
}

export function CreateCustomerDialog({
  open,
  onOpenChange,
  onCreated,
  defaultKind,
  hideKind = false,
  title,
  description,
}: CreateCustomerDialogProps) {
  const kind = defaultKind ?? CustomerKind.Organization
  const isPerson = kind === CustomerKind.Individual

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title ?? 'Новый клиент'}</SheetTitle>
          <SheetDescription>
            {description ?? 'Клиент создаётся здесь же. Данные заказа на странице не сбрасываются.'}
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <CreateCustomerForm
            key={kind}
            defaultKind={kind}
            hideKind={hideKind}
            successMessage={
              hideKind ? (isPerson ? 'Человек добавлен' : 'Организация добавлена') : 'Клиент создан'
            }
            onCreated={onCreated}
            onDone={(customer) => {
              onOpenChange(false)
              if (customer) {
                onCreated?.(customer)
              }
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function CreateCustomerForm({
  defaultKind,
  hideKind,
  successMessage,
  onCreated,
  onDone,
}: {
  defaultKind: CustomerKind
  hideKind: boolean
  successMessage: string
  onCreated?: (customer: Customer) => void
  onDone: (customer: Customer | null) => void
}) {
  const create = useCreateCustomer()
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: emptyCustomerForm(defaultKind),
  })
  useSheetDirty(form.formState.isDirty, () =>
    runSheetFormSave(form.handleSubmit, async (values) => {
      const id = await create.mutateAsync(values)
      const customer = await getCustomer(id)
      toast.success(successMessage)
      if (customer) {
        onCreated?.(customer)
      }
    }),
  )

  async function onSubmit(values: CustomerFormValues) {
    try {
      const id = await create.mutateAsync(values)
      const customer = await getCustomer(id)
      toast.success(successMessage)
      onDone(customer)
    } catch (error) {
      form.setError('name', { message: getErrorMessage(error) })
    }
  }

  return (
    <Form {...form}>
      <form className="flex flex-1 flex-col gap-4 px-4 pb-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CustomerFields form={form} hideKind={hideKind} />
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
  )
}
