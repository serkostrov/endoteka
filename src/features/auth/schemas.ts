import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().min(1, 'Укажите email').email('Некорректный email'),
  password: z.string().min(1, 'Укажите пароль'),
})

export type LoginFormValues = z.infer<typeof loginSchema>

export const setPasswordSchema = z
  .object({
    password: z.string().min(8, 'Пароль должен содержать не меньше 8 символов'),
    confirmPassword: z.string().min(1, 'Повторите пароль'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Пароли не совпадают',
    path: ['confirmPassword'],
  })

export type SetPasswordFormValues = z.infer<typeof setPasswordSchema>
