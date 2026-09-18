import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  markNestedDialogClosing,
  shouldIgnoreNestedDialogClose,
} from '@/components/ui/sheet'
import { getErrorMessage } from '@/lib/errors'

import { ItemFields } from './ItemFields'
import { useAddOrderCustomPartLine, useCreateInventoryItem } from '../hooks/use-inventory'
import { emptyInventoryItemFormValues, inventoryItemFormSchema, type InventoryItemFormValues } from '../schemas'
import { getInventoryItemCard, isInventoryDuplicateError, type InventoryItem } from '../services/inventory-service'

type CreateItemDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (item: InventoryItem) => void
  /** Если задан — можно создать строку только в этот заказ, без справочника. */
  orderId?: string
  onCreatedForOrder?: () => void
  initialQuery?: string
}

export function CreateItemDialog({
  open,
  onOpenChange,
  onCreated,
  orderId,
  onCreatedForOrder,
  initialQuery = '',
}: CreateItemDialogProps) {
  const create = useCreateInventoryItem()
  const addCustom = useAddOrderCustomPartLine(orderId ?? '')
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const form = useForm<InventoryItemFormValues>({
    resolver: zodResolver(inventoryItemFormSchema),
    defaultValues: emptyInventoryItemFormValues,
  })
  const canSaveCatalog = Boolean(onCreated) || !orderId
  const pending = create.isPending || addCustom.isPending

  useEffect(() => {
    if (!open) {
      return
    }
    form.reset({
      ...emptyInventoryItemFormValues,
      name: initialQuery.trim(),
    })
    setDuplicateId(null)
  }, [form, initialQuery, open])

  function closeOnly() {
    form.reset(emptyInventoryItemFormValues)
    setDuplicateId(null)
    markNestedDialogClosing()
    onOpenChange(false)
  }

  async function persistCatalog(values: InventoryItemFormValues) {
    try {
      const id = await create.mutateAsync(values)
      const card = await getInventoryItemCard(id)
      toast.success('Позиция добавлена в справочник')
      if (card) {
        onCreated?.(card.item)
      }
      closeOnly()
    } catch (error) {
      if (isInventoryDuplicateError(error)) {
        setDuplicateId(error.existingItemId)
        form.setError('name', { message: error.message })
      } else {
        form.setError('name', { message: getErrorMessage(error) })
      }
      throw error
    }
  }

  async function persistForOrder() {
    if (!orderId) {
      return
    }
    const name = form.getValues('name').trim()
    const unitPrice = form.getValues('repairPrice')
    if (!name) {
      form.setError('name', { message: 'Укажите наименование' })
      return
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      form.setError('repairPrice', { message: 'Цена не может быть отрицательной' })
      return
    }
    await addCustom.mutateAsync({ name, unitPrice, quantity: 1 })
    toast.success('Позиция добавлена в заказ')
    closeOnly()
    onCreatedForOrder?.()
  }

  async function onSubmit(values: InventoryItemFormValues) {
    if (orderId) {
      try {
        await persistForOrder()
      } catch (error) {
        toast.error(getErrorMessage(error))
      }
      return
    }
    try {
      await persistCatalog(values)
    } catch {
      return
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && shouldIgnoreNestedDialogClose()) {
          return
        }
        if (!next) {
          form.reset(emptyInventoryItemFormValues)
          setDuplicateId(null)
          markNestedDialogClosing()
        }
        onOpenChange(next)
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Новая позиция</SheetTitle>
          <SheetDescription>
            {orderId
              ? 'Можно добавить только в этот заказ или сохранить в справочник. Окно заказа останется открытым.'
              : 'Наименование уникально. После сохранения позиция применится к карточке.'}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.stopPropagation()
              void form.handleSubmit(onSubmit)(event)
            }}
            noValidate
          >
            {duplicateId ? (
              <Alert>
                <AlertTitle>Такое наименование уже в справочнике</AlertTitle>
                <AlertDescription>
                  <EntitySheetLink kind="item" id={duplicateId}>
                    Открыть существующую позицию
                  </EntitySheetLink>
                </AlertDescription>
              </Alert>
            ) : null}
            <ItemFields form={form} />
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
                          void form.handleSubmit(async (values) => {
                            try {
                              await persistCatalog(values)
                            } catch {
                              return
                            }
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
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    void persistForOrder().catch((error) => {
                      toast.error(getErrorMessage(error))
                    })
                  }}
                >
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
