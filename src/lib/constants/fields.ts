export const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

export const FieldType = {
  Text: 'text',
  Textarea: 'textarea',
  Number: 'number',
  Date: 'date',
  Select: 'select',
  Employee: 'employee',
  Checkbox: 'checkbox',
} as const

export type FieldType = (typeof FieldType)[keyof typeof FieldType]

export const fieldTypeLabels: Record<FieldType, string> = {
  text: 'Строка',
  textarea: 'Многострочный текст',
  number: 'Число',
  date: 'Дата',
  select: 'Список',
  employee: 'Сотрудник',
  checkbox: 'Флажок',
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

export const OrderBuiltinField = {
  CoverNote: 'claimed_malfunction',
  Completeness: 'completeness',
  Deadline: 'deadline',
  Responsible: 'responsible',
} as const

export type OrderBuiltinField = (typeof OrderBuiltinField)[keyof typeof OrderBuiltinField]

export const orderBuiltinFieldCodes = Object.values(OrderBuiltinField)

export function isOrderBuiltinField(code: string): code is OrderBuiltinField {
  return (orderBuiltinFieldCodes as string[]).includes(code)
}

export function orderBuiltinFieldType(code: OrderBuiltinField): FieldType {
  switch (code) {
    case OrderBuiltinField.Deadline:
      return FieldType.Date
    case OrderBuiltinField.Responsible:
      return FieldType.Employee
    default:
      return FieldType.Textarea
  }
}

export function resolvedFieldType(field: { code: string; fieldType: FieldType }): FieldType {
  if (isOrderBuiltinField(field.code) && field.fieldType === FieldType.Text) {
    return orderBuiltinFieldType(field.code)
  }
  return field.fieldType
}

export function fieldAllowsLayoutHeight(field: { code: string; fieldType: FieldType }): boolean {
  return resolvedFieldType(field) === FieldType.Textarea
}

export const FieldLayoutWidth = {
  Quarter: 'quarter',
  Third: 'third',
  Half: 'half',
  TwoThirds: 'two_thirds',
  ThreeQuarters: 'three_quarters',
  Full: 'full',
} as const

export type FieldLayoutWidth = (typeof FieldLayoutWidth)[keyof typeof FieldLayoutWidth]

export const fieldLayoutWidths = Object.values(FieldLayoutWidth)

export const fieldLayoutWidthLabels: Record<FieldLayoutWidth, string> = {
  quarter: '25%',
  third: '33%',
  half: '50%',
  two_thirds: '66%',
  three_quarters: '75%',
  full: '100%',
}

export const FieldLayoutHeight = {
  Compact: 'compact',
  Default: 'default',
  Tall: 'tall',
  Extra: 'extra',
} as const

export type FieldLayoutHeight = (typeof FieldLayoutHeight)[keyof typeof FieldLayoutHeight]

export const fieldLayoutHeights = Object.values(FieldLayoutHeight)

export const fieldLayoutHeightLabels: Record<FieldLayoutHeight, string> = {
  compact: 'Компактная',
  default: 'Обычная',
  tall: 'Высокая',
  extra: 'Очень высокая',
}

export function isFieldLayoutWidth(value: string): value is FieldLayoutWidth {
  return fieldLayoutWidths.includes(value as FieldLayoutWidth)
}

export function isFieldLayoutHeight(value: string): value is FieldLayoutHeight {
  return fieldLayoutHeights.includes(value as FieldLayoutHeight)
}

export function defaultFieldLayout(fieldType: FieldType): {
  width: FieldLayoutWidth
  height: FieldLayoutHeight
} {
  if (fieldType === FieldType.Textarea) {
    return { width: FieldLayoutWidth.Full, height: FieldLayoutHeight.Tall }
  }
  if (fieldType === FieldType.Checkbox) {
    return { width: FieldLayoutWidth.Half, height: FieldLayoutHeight.Compact }
  }
  return { width: FieldLayoutWidth.Half, height: FieldLayoutHeight.Default }
}

export function fieldLayoutWidthOf(field: {
  code: string
  fieldType: FieldType
  layoutWidth?: FieldLayoutWidth
}): FieldLayoutWidth {
  if (field.layoutWidth) {
    return field.layoutWidth
  }
  return defaultFieldLayout(resolvedFieldType(field)).width
}

export function fieldLayoutHeightOf(field: {
  code: string
  fieldType: FieldType
  layoutHeight?: FieldLayoutHeight
}): FieldLayoutHeight {
  if (!fieldAllowsLayoutHeight(field)) {
    return defaultFieldLayout(resolvedFieldType(field)).height
  }
  if (field.layoutHeight) {
    return field.layoutHeight
  }
  return defaultFieldLayout(resolvedFieldType(field)).height
}

export const fieldLayoutWidthCols: Record<FieldLayoutWidth, number> = {
  quarter: 3,
  third: 4,
  half: 6,
  two_thirds: 8,
  three_quarters: 9,
  full: 12,
}

export function snapFieldLayoutWidth(cols: number): FieldLayoutWidth {
  const clamped = Math.min(12, Math.max(3, cols))
  let best: FieldLayoutWidth = FieldLayoutWidth.Half
  let bestDist = Number.POSITIVE_INFINITY
  for (const width of fieldLayoutWidths) {
    const dist = Math.abs(fieldLayoutWidthCols[width] - clamped)
    if (dist < bestDist) {
      best = width
      bestDist = dist
    }
  }
  return best
}

export function snapFieldLayoutHeight(px: number): FieldLayoutHeight {
  const steps: { px: number; height: FieldLayoutHeight }[] = [
    { px: 84, height: FieldLayoutHeight.Compact },
    { px: 116, height: FieldLayoutHeight.Default },
    { px: 180, height: FieldLayoutHeight.Tall },
    { px: 260, height: FieldLayoutHeight.Extra },
  ]
  let best: FieldLayoutHeight = FieldLayoutHeight.Default
  let bestDist = Number.POSITIVE_INFINITY
  for (const step of steps) {
    const dist = Math.abs(step.px - px)
    if (dist < bestDist) {
      best = step.height
      bestDist = dist
    }
  }
  return best
}

export function fieldLayoutWidthClass(field: {
  code: string
  fieldType: FieldType
  layoutWidth?: FieldLayoutWidth
}) {
  switch (fieldLayoutWidthOf(field)) {
    case FieldLayoutWidth.Quarter:
      return 'col-span-12 sm:col-span-3'
    case FieldLayoutWidth.Third:
      return 'col-span-12 sm:col-span-4'
    case FieldLayoutWidth.TwoThirds:
      return 'col-span-12 sm:col-span-8'
    case FieldLayoutWidth.ThreeQuarters:
      return 'col-span-12 sm:col-span-9'
    case FieldLayoutWidth.Full:
      return 'col-span-12'
    default:
      return 'col-span-12 sm:col-span-6'
  }
}

export function fieldLayoutPreviewWidthClass(field: {
  code: string
  fieldType: FieldType
  layoutWidth?: FieldLayoutWidth
}) {
  switch (fieldLayoutWidthOf(field)) {
    case FieldLayoutWidth.Quarter:
      return 'col-span-3'
    case FieldLayoutWidth.Third:
      return 'col-span-4'
    case FieldLayoutWidth.TwoThirds:
      return 'col-span-8'
    case FieldLayoutWidth.ThreeQuarters:
      return 'col-span-9'
    case FieldLayoutWidth.Full:
      return 'col-span-12'
    default:
      return 'col-span-6'
  }
}

export function fieldLayoutHeightClass(field: {
  code: string
  fieldType: FieldType
  layoutHeight?: FieldLayoutHeight
}) {
  switch (fieldLayoutHeightOf(field)) {
    case FieldLayoutHeight.Compact:
      return '[&_input]:h-8! [&_[data-slot=select-trigger]]:h-8! [&_[data-slot=select-trigger]]:data-[size=default]:h-8! [&_textarea]:min-h-16'
    case FieldLayoutHeight.Tall:
      return '[&_input]:h-11! [&_[data-slot=select-trigger]]:h-11! [&_[data-slot=select-trigger]]:data-[size=default]:h-11! [&_textarea]:min-h-36'
    case FieldLayoutHeight.Extra:
      return '[&_input]:h-14! [&_[data-slot=select-trigger]]:h-14! [&_[data-slot=select-trigger]]:data-[size=default]:h-14! [&_textarea]:min-h-52'
    default:
      return '[&_input]:h-9 [&_[data-slot=select-trigger]]:h-9 [&_textarea]:min-h-24'
  }
}

export function fieldTextareaRows(field: {
  code: string
  fieldType: FieldType
  layoutHeight?: FieldLayoutHeight
}) {
  switch (fieldLayoutHeightOf(field)) {
    case FieldLayoutHeight.Compact:
      return 2
    case FieldLayoutHeight.Tall:
      return 6
    case FieldLayoutHeight.Extra:
      return 10
    default:
      return 4
  }
}
