import { z } from 'zod'

export const serviceTemplateFormSchema = z.object({
  name: z.string().trim().min(1, 'Укажите наименование'),
  description: z.string().trim(),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
})

export type ServiceTemplateFormValues = z.infer<typeof serviceTemplateFormSchema>

export const emptyServiceTemplateFormValues: ServiceTemplateFormValues = {
  name: '',
  description: '',
  unitPrice: 0,
}
