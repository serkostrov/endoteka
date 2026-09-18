import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

import { SheetEntityToolbar } from '@/components/shared/SheetEntityToolbar'
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
import { markNestedDialogClosing } from '@/components/ui/sheet'

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
  defaultParentId?: string
  /** Предзаполнить название (например, текст поиска). */
  defaultName?: string
  /** Родитель зафиксирован (выбор слева) — сверху и только для чтения. */
  lockParent?: boolean
  isPending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ReferenceItemFormValues) => Promise<void>
  onDelete?: () => void
}

export function ReferenceItemDialog({
  open,
  setName,
  requiresParent,
  parentLabel,
  parentOptions,
  item,
  defaultParentId = '',
  defaultName = '',
  lockParent = false,
  isPending,
  onOpenChange,
  onSubmit,
  onDelete,
}: ReferenceItemDialogProps) {
  const parentId = item?.parentId ?? defaultParentId
  const lockedParentName =
    parentOptions.find((option) => option.id === parentId)?.name ??
    parentOptions.find((option) => option.id === defaultParentId)?.name

  const form = useForm<ReferenceItemFormValues>({
    resolver: zodResolver(referenceItemSchema),
    values: {
      name: item?.name ?? defaultName,
      description: item?.description ?? '',
      parentId,
    },
  })

  async function handleSubmit(values: ReferenceItemFormValues) {
    if (requiresParent && !values.parentId) {
      form.setError('parentId', { message: `Выберите ${parentLabel ?? 'родителя'}` })
      return
    }

    try {
      // До await: пока закрывается Dialog, Sheet может получить dismiss.
      markNestedDialogClosing()
      await onSubmit(values)
      markNestedDialogClosing()
      onOpenChange(false)
    } catch (error) {
      form.setError('name', { message: getErrorMessage(error) })
    }
  }

  const parentField = requiresParent ? (
    lockParent ? (
      <div className="grid gap-2">
        <label className="text-sm font-medium leading-none">{parentLabel ?? 'Родитель'}</label>
        <Input value={lockedParentName ?? '—'} readOnly disabled className="bg-muted" />
      </div>
    ) : (
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
    )
  ) : null

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
        actions={item && onDelete ? <SheetEntityToolbar onDelete={onDelete} /> : null}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="pr-14">
          <DialogTitle>{item ? 'Изменить запись' : 'Новая запись'}</DialogTitle>
          <DialogDescription>Справочник: {setName}.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              // Портал Dialog внутри Sheet-формы: submit иначе всплывает по React-дереву
              // и сохраняет/закрывает «Новый прибор» / заказ.
              event.stopPropagation()
              void form.handleSubmit(handleSubmit)(event)
            }}
            noValidate
          >
            {lockParent ? parentField : null}
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
            {!lockParent ? parentField : null}
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
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  markNestedDialogClosing()
                  onOpenChange(false)
                }}
              >
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
