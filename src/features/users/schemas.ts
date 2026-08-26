import { z } from 'zod'

export const inviteUserSchema = z.object({
  email: z.string().min(1, 'Укажите email').email('Некорректный email'),
  fullName: z.string().min(1, 'Укажите имя'),
  roleId: z.string().min(1, 'Выберите роль'),
})

export type InviteUserFormValues = z.infer<typeof inviteUserSchema>

export const editUserSchema = z.object({
  fullName: z.string().min(1, 'Укажите имя'),
  roleId: z.string().min(1, 'Выберите роль'),
  isActive: z.boolean(),
  password: z
    .string()
    .refine((value) => value.trim() === '' || value.trim().length >= 8, {
      message: 'Пароль должен содержать не меньше 8 символов',
    }),
})

export type EditUserFormValues = z.infer<typeof editUserSchema>
