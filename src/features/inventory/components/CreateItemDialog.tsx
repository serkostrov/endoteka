import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'

import { ItemFields } from './ItemFields'
import { useCreateInventoryItem } from '../hooks/use-inventory'
import { emptyInventoryItemFormValues, inventoryItemFormSchema, type InventoryItemFormValues } from '../schemas'
import { getInventoryItemCard, isInventoryDuplicateError, type InventoryItem } from '../services/inventory-service'

type CreateItemDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (item: InventoryItem) => void
}

export function CreateItemDialog({ open, onOpenChange, onCreated }: CreateItemDialogProps) {
  const create = useCreateInventoryItem()
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const form = useForm<InventoryItemFormValues>({
    resolver: zodResolver(inventoryItemFormSchema),
    defaultValues: emptyInventoryItemFormValues,
  })

  async function onSubmit(values: InventoryItemFormValues) {
    try {
      const id = await create.mutateAsync(values)
      const card = await getInventoryItemCard(id)
      toast.success('Позиция создана')
      form.reset(emptyInventoryItemFormValues)
      setDuplicateId(null)
      onOpenChange(false)
      if (card) {
        onCreated?.(card.item)
      }
    } catch (error) {
      if (isInventoryDuplicateError(error)) {
        setDuplicateId(error.existingItemId)
        form.setError('name', { message: error.message })
        return
      }
      form.setError('name', { message: getErrorMessage(error) })
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(emptyInventoryItemFormValues)
          setDuplicateId(null)
        }
        onOpenChange(next)
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Новая позиция</SheetTitle>
          <SheetDescription>
            Наименование уникально. Приход и заказ остаются открытыми — данные не сбрасываются.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form className="flex flex-1 flex-col gap-4 px-4 pb-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            {duplicateId ? (
              <Alert>
                <AlertTitle>Такое наименование уже в справочнике</AlertTitle>
                <AlertDescription>
                  <Button asChild variant="link" className="h-auto px-0">
                    <Link to={routes.inventoryItem.replace(':id', duplicateId)}>Открыть существующую позицию</Link>
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <ItemFields form={form} />
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
