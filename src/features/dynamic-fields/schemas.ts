import { z } from 'zod'

import { FieldType, fieldTypes } from '@/lib/constants/fields'

import type { DynamicFieldDefinition, DynamicFieldValueData } from './services/fields-service'

export const fieldOptionFormSchema = z.object({
  code: z.string().trim(),
  label: z.string().trim().min(1, 'Укажите название варианта'),
  isActive: z.boolean(),
})

export const dynamicFieldFormSchema = z
  .object({
    code: z.string().trim(),
    name: z.string().trim().min(1, 'Укажите название').max(120, 'Слишком длинное название'),
    fieldType: z.enum(fieldTypes as [FieldType, ...FieldType[]]),
    isRequired: z.boolean(),
    groupName: z.string().max(80, 'Слишком длинное название группы'),
    options: z.array(fieldOptionFormSchema),
  })
  .superRefine((value, ctx) => {
    if (value.fieldType !== FieldType.Select) {
      return
    }

    if (value.options.filter((option) => option.isActive).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Добавьте хотя бы один активный вариант.',
        path: ['options'],
      })
    }
  })

export type DynamicFieldFormValues = z.infer<typeof dynamicFieldFormSchema>

export function buildFieldValueSchema(field: DynamicFieldDefinition) {
  if (field.fieldType === FieldType.Text) {
    const schema = z.string()
    return field.isRequired ? schema.min(1, 'Заполните поле') : schema
  }

  if (field.fieldType === FieldType.Number) {
    return field.isRequired
      ? z.number({ error: 'Укажите число' })
      : z.union([z.number(), z.null()])
  }

  const activeCodes = field.options.filter((option) => option.isActive).map((option) => option.code)
  if (activeCodes.length === 0) {
    return field.isRequired ? z.string().min(1, 'Выберите значение') : z.string()
  }

  const allowed = z.string().refine((value) => activeCodes.includes(value), 'Выберите значение из списка')
  return field.isRequired ? allowed : z.union([allowed, z.literal('')])
}

export function buildEntityValuesSchema(fields: DynamicFieldDefinition[]) {
  const shape: Record<string, z.ZodType<DynamicFieldValueData | string>> = {}

  for (const field of fields.filter((item) => item.isActive)) {
    shape[field.code] = buildFieldValueSchema(field)
  }

  return z.object(shape)
}

export function emptyFieldValue(field: DynamicFieldDefinition): DynamicFieldValueData {
  if (field.fieldType === FieldType.Number) {
    return null
  }

  return ''
}

export function formatFieldValue(field: DynamicFieldDefinition, value: DynamicFieldValueData): string {
  if (value === null || value === '') {
    return '—'
  }

  if (field.fieldType === FieldType.Select) {
    const option = field.options.find((item) => item.code === value)
    return option?.label ?? String(value)
  }

  return String(value)
}
