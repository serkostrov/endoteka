import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/lib/errors'
import { routes } from '@/lib/constants/routes'

import { useCreateRole, useRoles } from '../hooks/use-roles'
import { emptyRoleFormValues, roleFormSchema, type RoleFormValues } from '../schemas'

const NONE_COPY_VALUE = '__none__'

type CreateRoleSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateRoleSheet({ open, onOpenChange }: CreateRoleSheetProps) {
  const navigate = useNavigate()
  const create = useCreateRole()
  const rolesQuery = useRoles()
  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: emptyRoleFormValues,
  })

  useEffect(() => {
    if (!open) {
      return
    }
    form.reset(emptyRoleFormValues)
  }, [form, open])

  async function handleSubmit(values: RoleFormValues) {
    try {
      const id = await create.mutateAsync({
        name: values.name,
        description: values.description,
        copyFromRoleId: values.copyFromRoleId || undefined,
      })
      toast.success('Роль создана')
      onOpenChange(false)
      navigate(`${routes.roles}/${id}`)
    } catch (error) {
      const message = getErrorMessage(error)
      form.setError('name', { message })
      toast.error(message)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Новая роль</SheetTitle>
          <SheetDescription>
            Укажите название и при необходимости скопируйте права с существующей роли. Матрицу прав
            можно настроить на следующем шаге.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.stopPropagation()
              void form.handleSubmit(handleSubmit)(event)
            }}
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" placeholder="Например, Старший менеджер" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Описание</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={2}
                      placeholder="Кратко, для чего нужна роль"
                      className="field-sizing-content min-h-9 max-h-32 resize-none overflow-y-auto py-1.5 leading-5"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="copyFromRoleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Скопировать права из</FormLabel>
                  <Select
                    value={field.value || NONE_COPY_VALUE}
                    onValueChange={(next) => field.onChange(next === NONE_COPY_VALUE ? '' : next)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full" aria-label="Скопировать права из">
                        <SelectValue placeholder="Не копировать" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent searchable>
                      <SelectItem value={NONE_COPY_VALUE}>Не копировать</SelectItem>
                      {(rolesQuery.data ?? []).map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SheetFooter className="px-0">
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  Отмена
                </Button>
              </SheetClose>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Создание…' : 'Создать'}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
