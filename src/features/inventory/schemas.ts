import { z } from 'zod'

const moneySchema = z.number().min(0, 'Цена не может быть отрицательной')
const quantitySchema = z.number().positive('Количество должно быть больше нуля')

export const inventoryItemFormSchema = z.object({
  name: z.string().trim().min(1, 'Укажите наименование'),
  code: z.string().trim(),
  article: z.string().trim(),
  barcode: z.string().trim(),
  categoryId: z.string().min(1, 'Выберите категорию'),
  unitId: z.string().min(1, 'Выберите единицу измерения'),
  purchasePrice: moneySchema,
  repairPrice: moneySchema,
  retailPrice: moneySchema,
})

export type InventoryItemFormValues = z.infer<typeof inventoryItemFormSchema>

export const emptyInventoryItemFormValues: InventoryItemFormValues = {
  name: '',
  code: '',
  article: '',
  barcode: '',
  categoryId: '',
  unitId: '',
  purchasePrice: 0,
  repairPrice: 0,
  retailPrice: 0,
}

export const receiveFormSchema = z.object({
  supplier: z.string().trim().min(1, 'Укажите поставщика'),
  receiptDate: z.string().min(1, 'Укажите дату прихода'),
  notes: z.string().trim(),
})

export type ReceiveFormValues = z.infer<typeof receiveFormSchema>

export const consumeFormSchema = z.object({
  quantity: quantitySchema,
})

export type ConsumeFormValues = z.infer<typeof consumeFormSchema>

export const adjustFormSchema = z.object({
  quantityDelta: z.number().refine((value) => value !== 0, 'Количество не может быть нулевым'),
  reason: z.string().trim().min(1, 'Укажите причину'),
})

export type AdjustFormValues = z.infer<typeof adjustFormSchema>
