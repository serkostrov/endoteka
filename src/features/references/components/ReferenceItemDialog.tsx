import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/lib/errors'

import { referenceItemSchema, type ReferenceItemFormValues } from '../schemas'
import type { ReferenceItem } from '../services/references-service'

type ParentOption = {
  id: string
  name: string
  isActive: boolean
}

type ReferenceItemDialogProps = {
  open: boolean
  setName: string
  requiresParent: boolean
  parentLabel?: string | null
  parentOptions: ParentOption[]
  item: ReferenceItem | null
  isPending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ReferenceItemFormValues) => Promise<void>
}

export function ReferenceItemDialog({
  open,
  setName,
  requiresParent,
  parentLabel,
  parentOptions,
  item,
  isPending,
  onOpenChange,
  onSubmit,
}: ReferenceItemDialogProps) {
  const form = useForm<ReferenceItemFormValues>({
    resolver: zodResolver(referenceItemSchema),
    values: {
      name: item?.name ?? '',
      description: item?.description ?? '',
      parentId: item?.parentId ?? '',
    },
  })

  async function handleSubmit(values: ReferenceItemFormValues) {
    if (requiresParent && !values.parentId) {
      form.setError('parentId', { message: `Выберите ${parentLabel ?? 'родителя'}` })
      return
    }

    try {
      await onSubmit(values)
      onOpenChange(false)
    } catch (error) {
      form.setError('name', { message: getErrorMessage(error) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Изменить запись' : 'Новая запись'}</DialogTitle>
          <DialogDescription>Справочник: {setName}.</DialogDescription>
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
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {requiresParent ? (
              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{parentLabel ?? 'Родитель'}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите значение" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {parentOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                            {option.isActive ? '' : ' (скрыт)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Описание</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
