import { z } from 'zod'

export const deviceClassificationSchema = z.object({
  groupId: z.string(),
  brandId: z.string(),
  modelId: z.string(),
  modificationId: z.string(),
})

export const createDeviceSchema = deviceClassificationSchema.extend({
  serialNumber: z.string().trim().min(1, 'Укажите серийный номер'),
  customerId: z.string(),
})

export const editDeviceSchema = deviceClassificationSchema.extend({
  serialNumber: z.string().trim().min(1, 'Укажите серийный номер'),
})

export type DeviceClassificationFormValues = z.infer<typeof deviceClassificationSchema>
export type CreateDeviceFormValues = z.infer<typeof createDeviceSchema>
export type EditDeviceFormValues = z.infer<typeof editDeviceSchema>
