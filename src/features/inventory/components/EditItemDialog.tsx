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
import { useUpdateInventoryItem } from '../hooks/use-inventory'
import { inventoryItemFormSchema, type InventoryItemFormValues } from '../schemas'
import { isInventoryDuplicateError, type InventoryItem } from '../services/inventory-service'

type EditItemDialogProps = {
  item: InventoryItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditItemDialog({ item, open, onOpenChange }: EditItemDialogProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Изменить позицию</SheetTitle>
          <SheetDescription>Цены справочника не меняют уже оприходованные партии.</SheetDescription>
        </SheetHeader>
        {item ? <EditItemForm key={item.id} item={item} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function EditItemForm({ item, onDone }: { item: InventoryItem; onDone: () => void }) {
  const update = useUpdateInventoryItem(item.id)
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const form = useForm<InventoryItemFormValues>({
    resolver: zodResolver(inventoryItemFormSchema),
    defaultValues: {
      name: item.name,
      code: item.code,
      article: item.article,
      barcode: item.barcode,
      categoryId: item.categoryId,
      unitId: item.unitId,
      purchasePrice: item.purchasePrice,
      repairPrice: item.repairPrice,
      retailPrice: item.retailPrice,
    },
  })

  async function onSubmit(values: InventoryItemFormValues) {
    try {
      await update.mutateAsync(values)
      toast.success('Позиция сохранена')
      onDone()
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
        <ItemFields form={form} excludeItemId={item.id} />
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
