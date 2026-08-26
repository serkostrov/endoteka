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
import { useUpdateCustomer } from '../hooks/use-customers'
import { customerFormSchema, type CustomerFormValues } from '../schemas'
import type { Customer } from '../services/customers-service'

type EditCustomerDialogProps = {
  customer: Customer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditCustomerDialog({ customer, open, onOpenChange }: EditCustomerDialogProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Изменить клиента</SheetTitle>
          <SheetDescription>Контакты и реквизиты. Сохраняются отдельной кнопкой.</SheetDescription>
        </SheetHeader>
        {customer ? <EditCustomerForm key={customer.id} customer={customer} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function EditCustomerForm({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const update = useUpdateCustomer(customer.id)
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      kind: customer.kind,
      name: customer.name,
      contactName: customer.contactName,
      phone: customer.phone,
      email: customer.email,
      city: customer.city,
      inn: customer.inn,
      kpp: customer.kpp,
      ogrn: customer.ogrn,
      notes: customer.notes,
    },
  })

  async function onSubmit(values: CustomerFormValues) {
    try {
      await update.mutateAsync(values)
      toast.success('Клиент сохранён')
      onDone()
    } catch (error) {
      form.setError('name', { message: getErrorMessage(error) })
    }
  }

  return (
    <Form {...form}>
      <form className="flex flex-1 flex-col gap-4 px-4 pb-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CustomerFields form={form} excludeCustomerId={customer.id} />
        <SheetFooter className="px-0">
          <Button type="button" variant="outline" onClick={onDone}>
            Отмена
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  )
}
