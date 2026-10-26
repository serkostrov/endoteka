import { z } from 'zod'

export const roleFormSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название роли').max(80, 'Слишком длинное название'),
  description: z.string().trim().max(300, 'Слишком длинное описание'),
  copyFromRoleId: z.union([z.literal(''), z.string().uuid()]).default(''),
})

export type RoleFormValues = z.infer<typeof roleFormSchema>

export const emptyRoleFormValues: RoleFormValues = {
  name: '',
  description: '',
  copyFromRoleId: '',
}
