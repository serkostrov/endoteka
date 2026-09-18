import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { CustomerKind } from '@/lib/constants/customers'
import { getErrorMessage } from '@/lib/errors'
import { markNestedDialogClosing } from '@/components/ui/sheet'

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
  /** Предзаполнить название (текст поиска). */
  initialName?: string
}

export function CreateCustomerDialog({
  open,
  onOpenChange,
  onCreated,
  defaultKind,
  hideKind = false,
  title,
  description,
  initialName = '',
}: CreateCustomerDialogProps) {
  const kind = defaultKind ?? CustomerKind.Organization
  const isPerson = kind === CustomerKind.Individual

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          markNestedDialogClosing()
        }
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-h-[min(90vh,40rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="pr-14">
          <DialogTitle>{title ?? 'Новый клиент'}</DialogTitle>
          <DialogDescription>
            {description ??
              'Клиент создаётся здесь же. Окно заказа останется открытым — данные не сбрасываются.'}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <CreateCustomerForm
            key={`${kind}:${initialName}`}
            defaultKind={kind}
            hideKind={hideKind}
            initialName={initialName}
            successMessage={
              hideKind ? (isPerson ? 'Человек добавлен' : 'Организация добавлена') : 'Клиент создан'
            }
            onCreated={onCreated}
            onDone={(customer) => {
              markNestedDialogClosing()
              onOpenChange(false)
              if (customer) {
                onCreated?.(customer)
              }
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CreateCustomerForm({
  defaultKind,
  hideKind,
  initialName,
  successMessage,
  onDone,
}: {
  defaultKind: CustomerKind
  hideKind: boolean
  initialName: string
  successMessage: string
  onDone: (customer: Customer | null) => void
}) {
  const create = useCreateCustomer()
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      ...emptyCustomerForm(defaultKind),
      name: initialName.trim(),
    },
  })

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
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.stopPropagation()
          void form.handleSubmit(onSubmit)(event)
        }}
        noValidate
      >
        <CustomerFields form={form} hideKind={hideKind} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onDone(null)}>
            Отмена
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
