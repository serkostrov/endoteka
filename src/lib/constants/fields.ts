export const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

export const FieldType = {
  Text: 'text',
  Number: 'number',
  Select: 'select',
} as const

export type FieldType = (typeof FieldType)[keyof typeof FieldType]

export const fieldTypeLabels: Record<FieldType, string> = {
  text: 'Текст',
  number: 'Число',
  select: 'Список',
}

export const fieldTypes = Object.values(FieldType)

export function isFieldType(value: string): value is FieldType {
  return fieldTypes.includes(value as FieldType)
}

export const FieldEntity = {
  Orders: 'orders',
  Customers: 'customers',
  Devices: 'devices',
  Diagnostics: 'diagnostics',
  Inventory: 'inventory',
  Tasks: 'tasks',
} as const

export type FieldEntity = (typeof FieldEntity)[keyof typeof FieldEntity]
