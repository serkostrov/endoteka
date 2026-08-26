import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Control } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getErrorMessage } from '@/lib/errors'
import { uniqueCode } from '@/lib/utils/code'

import { orderStatusFormSchema, type OrderStatusFormValues } from '../schemas'
import type { OrderStatusCatalogItem } from '../lib/status-catalog'
import type { OrderStatusGroupRecord } from '../services/orders-service'

type OrderStatusEditorProps = {
  open: boolean
  item: OrderStatusCatalogItem | null
  defaultGroupId?: string
  groups: OrderStatusGroupRecord[]
  usedCodes: string[]
  isPending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: OrderStatusFormValues & { code: string }) => Promise<void>
}

export function OrderStatusEditor({
  open,
  item,
  defaultGroupId,
  groups,
  usedCodes,
  isPending,
  onOpenChange,
  onSubmit,
}: OrderStatusEditorProps) {
  const form = useForm<OrderStatusFormValues>({
    resolver: zodResolver(orderStatusFormSchema),
    values: {
      name: item?.name ?? '',
      groupId: item?.groupId ?? defaultGroupId ?? groups[0]?.id ?? '',
      color: item?.color && item.color !== item.groupColor ? item.color : '',
      isInitial: item?.isInitial ?? false,
      isTerminal: item?.isTerminal ?? false,
      notifiesWarehouse: item?.notifiesWarehouse ?? false,
      requiresWarranty: item?.requiresWarranty ?? false,
      isDestructive: item?.isDestructive ?? false,
      isActive: item?.isActive ?? true,
    },
  })

  async function handleSubmit(values: OrderStatusFormValues) {
    try {
      await onSubmit({
        ...values,
        color: values.color.trim(),
        code: item?.code ?? uniqueCode(values.name, usedCodes, 'status'),
      })
      onOpenChange(false)
    } catch (error) {
      form.setError('name', { message: getErrorMessage(error) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? 'Изменить статус' : 'Новый статус'}</DialogTitle>
          <DialogDescription>Группа определяет колонку на доске и цвет метки.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)} noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Например, Диагностика" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Группа</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Выберите группу" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Цвет метки</FormLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      type="color"
                      className="h-9 w-12 cursor-pointer p-1"
                      value={/^#[0-9A-Fa-f]{6}$/.test(field.value) ? field.value : '#2563eb'}
                      onChange={(event) => field.onChange(event.target.value)}
                      aria-label="Цвет статуса"
                    />
                    <FormControl>
                      <Input {...field} placeholder="Как у группы" />
                    </FormControl>
                  </div>
                  <p className="text-xs text-muted-foreground">Пустое значение — цвет группы.</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FlagField control={form.control} name="isInitial" label="Начальный при создании заказа" />
              <FlagField control={form.control} name="isTerminal" label="Закрывает заказ" />
              <FlagField control={form.control} name="requiresWarranty" label="Спрашивать гарантию" />
              <FlagField control={form.control} name="isDestructive" label="Отказ / неуспешное закрытие" />
              <FlagField control={form.control} name="notifiesWarehouse" label="Уведомлять склад" />
              <FlagField control={form.control} name="isActive" label="Показывать в списках" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function FlagField({
  control,
  name,
  label,
}: {
  control: Control<OrderStatusFormValues>
  name: keyof Pick<
    OrderStatusFormValues,
    'isInitial' | 'isTerminal' | 'notifiesWarehouse' | 'requiresWarranty' | 'isDestructive' | 'isActive'
  >
  label: string
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-center gap-2 space-y-0">
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
          </FormControl>
          <FormLabel className="font-normal">{label}</FormLabel>
        </FormItem>
      )}
    />
  )
}
