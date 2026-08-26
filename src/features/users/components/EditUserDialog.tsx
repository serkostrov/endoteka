import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
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
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth'
import { useAssignableRoles } from '@/features/roles/hooks/use-roles'
import { getErrorMessage } from '@/lib/errors'
import { toast } from 'sonner'

import { useUpdateUserAccount } from '../hooks/use-user-mutations'
import { editUserSchema, type EditUserFormValues } from '../schemas'
import type { UserAccount } from '../services/users-service'

type EditUserDialogProps = {
  user: UserAccount | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditUserDialog({ user, open, onOpenChange }: EditUserDialogProps) {
  const { user: currentUser, refreshUser } = useAuth()
  const rolesQuery = useAssignableRoles(open)
  const updateAccount = useUpdateUserAccount()
  const isSelf = Boolean(user && currentUser && user.id === currentUser.id)
  const form = useForm<EditUserFormValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { fullName: '', roleId: '', isActive: true, password: '' },
  })

  useEffect(() => {
    if (open && user) {
      form.reset({
        fullName: user.fullName,
        roleId: user.roleId ?? '',
        isActive: user.isActive,
        password: '',
      })
    }
  }, [form, open, user])

  const assignable = rolesQuery.data ?? []
  const roleOptions =
    user?.roleId && !assignable.some((role) => role.id === user.roleId)
      ? [
          {
            id: user.roleId,
            code: user.roleCode ?? '',
            name: user.roleName ?? 'Текущая роль',
            description: null,
          },
          ...assignable,
        ]
      : assignable

  async function onSubmit(values: EditUserFormValues) {
    if (!user) {
      return
    }

    try {
      await updateAccount.mutateAsync({
        userId: user.id,
        fullName: values.fullName,
        roleId: values.roleId,
        isActive: isSelf ? user.isActive : values.isActive,
        password: values.password.trim(),
      })
      if (isSelf) {
        await refreshUser()
      }
      toast.success('Сотрудник сохранён')
      onOpenChange(false)
    } catch (error) {
      form.setError('fullName', { message: getErrorMessage(error) })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset()
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Изменить сотрудника</DialogTitle>
          <DialogDescription>
            Email изменить нельзя. Пароль меняется только если поле заполнено.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Имя</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-2">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" value={user?.email ?? ''} type="email" disabled readOnly autoComplete="off" />
            </div>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Пароль</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="new-password" placeholder="Новый пароль" />
                  </FormControl>
                  <p className="text-sm text-muted-foreground">Если оставить пустым, пароль не изменится.</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Роль</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full" aria-label="Роль">
                        <SelectValue placeholder="Выберите роль" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {roleOptions.map((role) => (
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
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Статус</FormLabel>
                  <Select
                    value={field.value ? 'active' : 'inactive'}
                    onValueChange={(value) => field.onChange(value === 'active')}
                    disabled={isSelf}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full" aria-label="Статус">
                        <SelectValue placeholder="Статус" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Активен</SelectItem>
                      <SelectItem value="inactive">Отключён</SelectItem>
                    </SelectContent>
                  </Select>
                  {isSelf ? (
                    <p className="text-sm text-muted-foreground">Нельзя изменить статус собственной учётной записи.</p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={updateAccount.isPending || rolesQuery.isLoading || !user}>
                {updateAccount.isPending ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
