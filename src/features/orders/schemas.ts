import { z } from 'zod'

export const createOrderSchema = z.object({
  customerId: z.string().min(1, 'Выберите клиента'),
  deviceId: z.string().min(1, 'Выберите прибор'),
  claimedMalfunction: z.string().trim().min(1, 'Укажите заявленную неисправность'),
  completeness: z.string(),
  externalCondition: z.string(),
  deadline: z.string(),
  responsibleId: z.string(),
})

export type CreateOrderFormValues = z.infer<typeof createOrderSchema>

export const updateOrderRepairSchema = z.object({
  claimedMalfunction: z.string().trim().min(1, 'Укажите заявленную неисправность'),
  completeness: z.string(),
  externalCondition: z.string(),
  deadline: z.string(),
  responsibleId: z.string(),
})

export type UpdateOrderRepairFormValues = z.infer<typeof updateOrderRepairSchema>

export const attachmentUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Укажите ссылку')
    .refine((value) => /^https?:\/\//i.test(value), 'Ссылка должна начинаться с http:// или https://'),
  caption: z.string(),
})

export type AttachmentUrlFormValues = z.infer<typeof attachmentUrlSchema>

export const orderNumberStartSchema = z.object({
  start: z.number().int('Укажите целое число').min(1, 'Начальный номер должен быть больше нуля'),
})

export type OrderNumberStartFormValues = z.infer<typeof orderNumberStartSchema>

export const workflowTransitionSchema = z.object({
  fromStatusId: z.string().min(1, 'Выберите исходный статус'),
  toStatusId: z.string().min(1, 'Выберите новый статус'),
  requiredPermission: z.string().min(1, 'Выберите право'),
  ruleCodes: z.array(z.string()),
  isActive: z.boolean(),
})

export type WorkflowTransitionFormValues = z.infer<typeof workflowTransitionSchema>

export const orderStatusFormSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(120, 'Слишком длинное название'),
  groupId: z.string().min(1, 'Выберите группу'),
  color: z.string(),
  isInitial: z.boolean(),
  isTerminal: z.boolean(),
  notifiesWarehouse: z.boolean(),
  requiresWarranty: z.boolean(),
  isDestructive: z.boolean(),
  isActive: z.boolean(),
})

export type OrderStatusFormValues = z.infer<typeof orderStatusFormSchema>

export const orderStatusGroupFormSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(80, 'Слишком длинное название'),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Цвет — HEX вида #2563eb'),
})

export type OrderStatusGroupFormValues = z.infer<typeof orderStatusGroupFormSchema>
