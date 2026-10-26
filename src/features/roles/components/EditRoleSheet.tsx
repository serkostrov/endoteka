import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
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

import { useUpdateRole } from '../hooks/use-roles'
import { roleFormSchema, type RoleFormValues } from '../schemas'
import type { RoleRecord } from '../services/roles-service'

type EditRoleSheetProps = {
  role: RoleRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditRoleSheet({ role, open, onOpenChange }: EditRoleSheetProps) {
  if (!role) {
    return null
  }

  return <EditRoleForm key={role.id} role={role} open={open} onOpenChange={onOpenChange} />
}

function EditRoleForm({
  role,
  open,
  onOpenChange,
}: {
  role: RoleRecord
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateRole()
  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: {
      name: role.name,
      description: role.description ?? '',
      copyFromRoleId: '',
    },
  })

  async function handleSubmit(values: RoleFormValues) {
    try {
      await update.mutateAsync({
        id: role.id,
        name: values.name,
        description: values.description,
      })
      toast.success('Роль сохранена')
      onOpenChange(false)
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
          <SheetTitle>Изменить роль</SheetTitle>
          <SheetDescription>
            Можно изменить название и описание. Код роли и матрица прав задаются отдельно.
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
                    <Input {...field} autoComplete="off" />
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
            <SheetFooter className="px-0">
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  Отмена
                </Button>
              </SheetClose>
              <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
                {update.isPending ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
