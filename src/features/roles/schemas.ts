import { z } from 'zod'

export const roleFormSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название роли').max(80, 'Слишком длинное название'),
  description: z.string().trim().max(300, 'Слишком длинное описание'),
  /** Пустая строка = не копировать права. */
  copyFromRoleId: z.union([z.literal(''), z.string().uuid()]),
})

export type RoleFormValues = z.infer<typeof roleFormSchema>

export const emptyRoleFormValues: RoleFormValues = {
  name: '',
  description: '',
  copyFromRoleId: '',
}
