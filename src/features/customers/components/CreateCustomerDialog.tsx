import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { getErrorMessage } from '@/lib/errors'

import { CustomerFields } from './CustomerFields'
import { useCreateCustomer } from '../hooks/use-customers'
import { emptyCustomerFormValues, customerFormSchema, type CustomerFormValues } from '../schemas'
import { getCustomer } from '../services/customers-service'
import type { Customer } from '../services/customers-service'

type CreateCustomerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (customer: Customer) => void
}

export function CreateCustomerDialog({ open, onOpenChange, onCreated }: CreateCustomerDialogProps) {
  const create = useCreateCustomer()
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: emptyCustomerFormValues,
  })

  async function onSubmit(values: CustomerFormValues) {
    try {
      const id = await create.mutateAsync(values)
      const customer = await getCustomer(id)
      toast.success('Клиент создан')
      form.reset(emptyCustomerFormValues)
      onOpenChange(false)
      if (customer) {
        onCreated?.(customer)
      }
    } catch (error) {
      form.setError('name', { message: getErrorMessage(error) })
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(emptyCustomerFormValues)
        }
        onOpenChange(next)
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Новый клиент</SheetTitle>
          <SheetDescription>
            Клиент создаётся здесь же. Данные заказа на странице не сбрасываются.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form className="flex flex-1 flex-col gap-4 px-4 pb-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <CustomerFields form={form} />
            <SheetFooter className="px-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
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
