import { useState } from 'react'
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatQuantity } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'

import { ItemSearchField } from './ItemSearchField'
import { useAdjustInventory } from '../hooks/use-inventory'
import { adjustFormSchema, type AdjustFormValues } from '../schemas'
import type { InventoryItem } from '../services/inventory-service'

type AdjustDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: InventoryItem | null
}

export function AdjustStockDialog({ open, onOpenChange, item = null }: AdjustDialogProps) {
  const adjust = useAdjustInventory()
  const [picked, setPicked] = useState<InventoryItem | null>(item)
  const form = useForm<AdjustFormValues>({
    resolver: zodResolver(adjustFormSchema),
    defaultValues: { quantityDelta: 1, reason: '' },
  })
  const current = item ?? picked

  async function onSubmit(values: AdjustFormValues) {
    if (!current) {
      return
    }
    try {
      await adjust.mutateAsync({
        itemId: current.id,
        quantityDelta: values.quantityDelta,
        reason: values.reason,
      })
      toast.success('Корректировка записана')
      form.reset({ quantityDelta: 1, reason: '' })
      setPicked(null)
      onOpenChange(false)
    } catch (error) {
      form.setError('quantityDelta', { message: getErrorMessage(error) })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPicked(item)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Инвентаризация</DialogTitle>
          <DialogDescription>
            Плюс увеличивает остаток новой партией, минус списывает FIFO. Отрицательный остаток невозможен.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            {item ? (
              <p className="text-sm">
                {item.name} · остаток {formatQuantity(item.stockQuantity)} {item.unitName}
              </p>
            ) : (
              <ItemSearchField selected={picked} onSelect={setPicked} onClear={() => setPicked(null)} />
            )}
            <FormField
              control={form.control}
              name="quantityDelta"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Изменение количества</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.001"
                      value={field.value}
                      onChange={(event) => field.onChange(Number(event.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Причина</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={adjust.isPending || !current}>
                {adjust.isPending ? 'Запись…' : 'Провести'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
