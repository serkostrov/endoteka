import { z } from 'zod'

import {
  FieldType,
  fieldLayoutHeights,
  fieldLayoutWidths,
  fieldTypes,
  resolvedFieldType,
  type FieldLayoutHeight,
  type FieldLayoutWidth,
} from '@/lib/constants/fields'

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
    layoutWidth: z.enum(fieldLayoutWidths as [FieldLayoutWidth, ...FieldLayoutWidth[]]),
    layoutHeight: z.enum(fieldLayoutHeights as [FieldLayoutHeight, ...FieldLayoutHeight[]]),
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

function requiredText(message: string) {
  return z.string().trim().min(1, message)
}

export function buildFieldValueSchema(field: DynamicFieldDefinition) {
  const fieldType = resolvedFieldType(field)

  if (fieldType === FieldType.Number) {
    return field.isRequired
      ? z.number({ error: 'Укажите число' })
      : z.union([z.number(), z.null()])
  }

  if (fieldType === FieldType.Checkbox) {
    return field.isRequired ? z.literal(true, { error: 'Отметьте поле' }) : z.boolean()
  }

  if (fieldType === FieldType.Select) {
    const activeCodes = field.options.filter((option) => option.isActive).map((option) => option.code)
    if (activeCodes.length === 0) {
      return field.isRequired ? z.string().min(1, 'Выберите значение') : z.string()
    }

    const allowed = z.string().refine((value) => activeCodes.includes(value), 'Выберите значение из списка')
    return field.isRequired ? allowed : z.union([allowed, z.literal('')])
  }

  if (fieldType === FieldType.Date) {
    return field.isRequired ? requiredText('Укажите дату') : z.string()
  }

  if (fieldType === FieldType.Employee) {
    return field.isRequired ? requiredText('Выберите сотрудника') : z.string()
  }

  return field.isRequired ? requiredText('Заполните поле') : z.string()
}

export function buildEntityValuesSchema(fields: DynamicFieldDefinition[]) {
  const shape: Record<string, z.ZodType<DynamicFieldValueData | string | boolean>> = {}

  for (const field of fields.filter((item) => item.isActive)) {
    shape[field.code] = buildFieldValueSchema(field)
  }

  return z.object(shape)
}

export function emptyFieldValue(field: DynamicFieldDefinition): DynamicFieldValueData {
  const fieldType = resolvedFieldType(field)
  if (fieldType === FieldType.Number) {
    return null
  }
  if (fieldType === FieldType.Checkbox) {
    return false
  }
  return ''
}

export function filledFieldValues(
  fields: { code: string; fieldType: string }[],
  values: Record<string, DynamicFieldValueData>,
) {
  const result: Record<string, DynamicFieldValueData> = {}
  for (const field of fields) {
    const current = values[field.code]
    if (current !== undefined) {
      result[field.code] = current
      continue
    }
    if (field.fieldType === FieldType.Number) {
      result[field.code] = null
    } else if (field.fieldType === FieldType.Checkbox) {
      result[field.code] = false
    } else {
      result[field.code] = ''
    }
  }
  return result
}

export function formatFieldValue(field: DynamicFieldDefinition, value: DynamicFieldValueData): string {
  if (value === null || value === '') {
    return '—'
  }

  const fieldType = resolvedFieldType(field)

  if (fieldType === FieldType.Checkbox) {
    return value === true ? 'Да' : 'Нет'
  }

  if (fieldType === FieldType.Select) {
    const option = field.options.find((item) => item.code === value)
    return option?.label ?? String(value)
  }

  return String(value)
}
