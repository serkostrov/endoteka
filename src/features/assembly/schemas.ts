import { z } from 'zod'

export const assemblyPartDraftSchema = z.object({
  name: z.string().trim().min(1, 'Укажите наименование'),
  qtyRequired: z.coerce.number().min(0, 'Не меньше 0'),
  qtyCollected: z.coerce.number().min(0, 'Не меньше 0'),
  comment: z.string().trim().optional().default(''),
})

export type AssemblyPartDraft = z.infer<typeof assemblyPartDraftSchema>
