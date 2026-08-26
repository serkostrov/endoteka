import { z } from 'zod'

export const referenceItemSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(120, 'Слишком длинное название'),
  description: z.string().max(500, 'Слишком длинное описание'),
  parentId: z.string(),
})

export type ReferenceItemFormValues = z.infer<typeof referenceItemSchema>
