import { isOrderBuiltinField, OrderBuiltinField, type FieldType } from '@/lib/constants/fields'

import { isDocumentDateKey } from './date-formats'

export const placeholderKeys = [
  'company.name',
  'document.number',
  'document.issuedAt',
  'order.number',
  'order.createdAt',
  'order.status',
  'order.claimedMalfunction',
  'order.completeness',
  'order.externalCondition',
  'order.deadline',
  'order.readyDate',
  'order.responsible',
  'customer.name',
  'customer.phone',
  'customer.email',
  'customer.inn',
  'customer.city',
  'customer.contactName',
  'device.serialNumber',
  'device.model',
  'device.brand',
  'device.group',
  'device.label',
  'sale.invoiceNumber',
  'sale.date',
  'sale.total',
  'sale.customerName',
  'sale.status',
  'item.name',
  'item.code',
  'item.article',
  'item.barcode',
  'part.name',
  'part.code',
  'part.article',
  'part.quantity',
  'part.unitName',
  'part.price',
  'line.name',
  'line.code',
  'line.article',
  'line.quantity',
  'line.unitName',
  'line.price',
  'line.amount',
] as const

export type PlaceholderKey = (typeof placeholderKeys)[number]

export type PlaceholderDefinition = {
  key: string
  label: string
  group: string
  scope: 'document' | 'row'
  isDate?: boolean
}

const ORDER_BUILTIN_PLACEHOLDER: Record<string, PlaceholderKey> = {
  [OrderBuiltinField.CoverNote]: 'order.claimedMalfunction',
  [OrderBuiltinField.Completeness]: 'order.completeness',
  [OrderBuiltinField.Deadline]: 'order.deadline',
  [OrderBuiltinField.ReadyDate]: 'order.readyDate',
  [OrderBuiltinField.Responsible]: 'order.responsible',
}

export const placeholderRegistry: Record<PlaceholderKey, PlaceholderDefinition> = {
  'company.name': { key: 'company.name', label: 'Название компании', group: 'Компания', scope: 'document' },
  'document.number': { key: 'document.number', label: 'Номер документа', group: 'Документ', scope: 'document' },
  'document.issuedAt': {
    key: 'document.issuedAt',
    label: 'Дата выпуска',
    group: 'Документ',
    scope: 'document',
    isDate: true,
  },
  'order.number': { key: 'order.number', label: 'Номер заказа', group: 'Заказ', scope: 'document' },
  'order.createdAt': {
    key: 'order.createdAt',
    label: 'Дата заказа',
    group: 'Заказ',
    scope: 'document',
    isDate: true,
  },
  'order.status': { key: 'order.status', label: 'Статус заказа', group: 'Заказ', scope: 'document' },
  'order.claimedMalfunction': {
    key: 'order.claimedMalfunction',
    label: 'Сопроводительная записка',
    group: 'Заказ',
    scope: 'document',
  },
  'order.completeness': { key: 'order.completeness', label: 'Комплектация', group: 'Заказ', scope: 'document' },
  'order.externalCondition': {
    key: 'order.externalCondition',
    label: 'Внешний вид',
    group: 'Заказ',
    scope: 'document',
  },
  'order.deadline': { key: 'order.deadline', label: 'Срок заказа', group: 'Заказ', scope: 'document', isDate: true },
  'order.readyDate': {
    key: 'order.readyDate',
    label: 'Дата готовности',
    group: 'Заказ',
    scope: 'document',
    isDate: true,
  },
  'order.responsible': { key: 'order.responsible', label: 'Ответственный', group: 'Заказ', scope: 'document' },
  'customer.name': { key: 'customer.name', label: 'Клиент', group: 'Клиент', scope: 'document' },
  'customer.phone': { key: 'customer.phone', label: 'Телефон клиента', group: 'Клиент', scope: 'document' },
  'customer.email': { key: 'customer.email', label: 'Email клиента', group: 'Клиент', scope: 'document' },
  'customer.inn': { key: 'customer.inn', label: 'ИНН клиента', group: 'Клиент', scope: 'document' },
  'customer.city': { key: 'customer.city', label: 'Город клиента', group: 'Клиент', scope: 'document' },
  'customer.contactName': {
    key: 'customer.contactName',
    label: 'Контактное лицо',
    group: 'Клиент',
    scope: 'document',
  },
  'device.serialNumber': {
    key: 'device.serialNumber',
    label: 'Серийный номер',
    group: 'Прибор',
    scope: 'document',
  },
  'device.model': { key: 'device.model', label: 'Модель прибора', group: 'Прибор', scope: 'document' },
  'device.brand': { key: 'device.brand', label: 'Производитель', group: 'Прибор', scope: 'document' },
  'device.group': { key: 'device.group', label: 'Тип прибора', group: 'Прибор', scope: 'document' },
  'device.label': { key: 'device.label', label: 'Прибор', group: 'Прибор', scope: 'document' },
  'sale.invoiceNumber': { key: 'sale.invoiceNumber', label: 'Номер счёта', group: 'Продажа', scope: 'document' },
  'sale.date': { key: 'sale.date', label: 'Дата продажи', group: 'Продажа', scope: 'document', isDate: true },
  'sale.total': { key: 'sale.total', label: 'Сумма продажи', group: 'Продажа', scope: 'document' },
  'sale.customerName': { key: 'sale.customerName', label: 'Покупатель', group: 'Продажа', scope: 'document' },
  'sale.status': { key: 'sale.status', label: 'Статус продажи', group: 'Продажа', scope: 'document' },
  'item.name': { key: 'item.name', label: 'Название позиции', group: 'Номенклатура', scope: 'document' },
  'item.code': { key: 'item.code', label: 'Код позиции', group: 'Номенклатура', scope: 'document' },
  'item.article': { key: 'item.article', label: 'Артикул', group: 'Номенклатура', scope: 'document' },
  'item.barcode': { key: 'item.barcode', label: 'Штрихкод позиции', group: 'Номенклатура', scope: 'document' },
  'part.name': { key: 'part.name', label: 'Название запчасти', group: 'Запчасть', scope: 'row' },
  'part.code': { key: 'part.code', label: 'Код запчасти', group: 'Запчасть', scope: 'row' },
  'part.article': { key: 'part.article', label: 'Артикул запчасти', group: 'Запчасть', scope: 'row' },
  'part.quantity': { key: 'part.quantity', label: 'Количество запчасти', group: 'Запчасть', scope: 'row' },
  'part.unitName': { key: 'part.unitName', label: 'Единица запчасти', group: 'Запчасть', scope: 'row' },
  'part.price': { key: 'part.price', label: 'Цена запчасти', group: 'Запчасть', scope: 'row' },
  'line.name': { key: 'line.name', label: 'Название строки', group: 'Строка накладной', scope: 'row' },
  'line.code': { key: 'line.code', label: 'Код строки', group: 'Строка накладной', scope: 'row' },
  'line.article': { key: 'line.article', label: 'Артикул строки', group: 'Строка накладной', scope: 'row' },
  'line.quantity': { key: 'line.quantity', label: 'Количество строки', group: 'Строка накладной', scope: 'row' },
  'line.unitName': { key: 'line.unitName', label: 'Единица строки', group: 'Строка накладной', scope: 'row' },
  'line.price': { key: 'line.price', label: 'Цена строки', group: 'Строка накладной', scope: 'row' },
  'line.amount': { key: 'line.amount', label: 'Сумма строки', group: 'Строка накладной', scope: 'row' },
}

export const placeholderKeySet = new Set<string>(placeholderKeys)

export function isPlaceholderKey(value: string): value is PlaceholderKey {
  return placeholderKeySet.has(value)
}

export type PlaceholderInsertContext = 'document' | 'parts' | 'lines'

export type TemplateTextSegment =
  | { type: 'text'; value: string }
  | { type: 'field'; key: string }

const PLACEHOLDER_TOKEN_PATTERN =
  /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)(?:\|[^}]*)?\s*\}\}/g

export function parseTemplateText(value: string): TemplateTextSegment[] {
  const segments: TemplateTextSegment[] = []
  const pattern = new RegExp(PLACEHOLDER_TOKEN_PATTERN.source, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: value.slice(lastIndex, match.index) })
    }
    const key = match[1]
    if (key && (isPlaceholderKey(key) || isSettingsFieldKey(key))) {
      segments.push({ type: 'field', key })
    } else {
      segments.push({ type: 'text', value: match[0] })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < value.length) {
    segments.push({ type: 'text', value: value.slice(lastIndex) })
  }

  return segments
}

export function isSettingsFieldKey(key: string) {
  return /^field\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(key)
}

export function settingsFieldPlaceholderKey(entityCode: string, code: string) {
  if (entityCode === 'orders' && isOrderBuiltinField(code)) {
    return ORDER_BUILTIN_PLACEHOLDER[code]
  }
  return `field.${entityCode}.${code}`
}

export function settingsFieldDefinition(input: {
  entityCode: string
  entityName: string
  code: string
  name: string
  fieldType: FieldType
}): PlaceholderDefinition | null {
  const key = settingsFieldPlaceholderKey(input.entityCode, input.code)
  if (!key) {
    return null
  }
  if (isPlaceholderKey(key)) {
    return {
      ...placeholderRegistry[key],
      isDate: isDocumentDateKey(key) || input.fieldType === 'date',
    }
  }
  return {
    key,
    label: input.name,
    group: input.entityName,
    scope: 'document',
    isDate: input.fieldType === 'date',
  }
}

export function mergePlaceholderCatalog(
  base: PlaceholderDefinition[],
  settingsFields: PlaceholderDefinition[],
) {
  const seen = new Set(base.map((item) => item.key))
  const extras = settingsFields.filter((item) => {
    if (seen.has(item.key)) {
      return false
    }
    seen.add(item.key)
    return true
  })
  return [...base, ...extras]
}

export function placeholdersForContext(context: PlaceholderInsertContext): PlaceholderDefinition[] {
  const all = placeholderKeys.map((key) => placeholderRegistry[key])
  if (context === 'parts') {
    return [
      ...all.filter((item) => item.key.startsWith('part.')),
      ...all.filter((item) => item.scope === 'document'),
    ]
  }
  if (context === 'lines') {
    return [
      ...all.filter((item) => item.key.startsWith('line.')),
      ...all.filter((item) => item.scope === 'document'),
    ]
  }
  return all.filter((item) => item.scope === 'document')
}

export function groupPlaceholders(items: PlaceholderDefinition[]) {
  const groups: { name: string; items: PlaceholderDefinition[] }[] = []
  for (const item of items) {
    const current = groups[groups.length - 1]
    if (current?.name === item.group) {
      current.items.push(item)
    } else {
      groups.push({ name: item.group, items: [item] })
    }
  }
  return groups
}

export const SAMPLE_PLACEHOLDER_VALUES: Record<string, string> = {
  'company.name': 'Эндотека',
  'document.number': 'ДОК-000001',
  'document.issuedAt': '2026-08-25T12:00:00',
  'order.number': 'ЗК-0001',
  'order.createdAt': '2026-08-25',
  'order.status': 'В ремонте',
  'order.claimedMalfunction': 'Нет изображения',
  'order.completeness': 'Прибор, кейс, кабель',
  'order.externalCondition': 'Царапины корпуса',
  'order.deadline': '2026-09-01',
  'order.readyDate': '2026-09-03',
  'order.responsible': 'Иванов И. И.',
  'customer.name': 'ООО «Клиника»',
  'customer.phone': '+7 495 000-00-00',
  'customer.email': 'clinic@example.com',
  'customer.inn': '7700000000',
  'customer.city': 'Москва',
  'customer.contactName': 'Петров П. П.',
  'device.serialNumber': 'SN-12345',
  'device.model': 'GIF-H190',
  'device.brand': 'Olympus',
  'device.group': 'Гастроскоп',
  'device.label': 'Гастроскоп · Olympus · GIF-H190',
  'sale.invoiceNumber': 'СЧ-000001',
  'sale.date': '2026-08-25',
  'sale.total': '15000.00',
  'sale.customerName': 'ООО «Клиника»',
  'sale.status': 'Подтверждена',
  'item.name': 'Уплотнитель канала',
  'item.code': 'INV-000001',
  'item.article': 'ART-100',
  'item.barcode': '2000000000016',
  'part.name': 'Уплотнитель канала',
  'part.code': 'INV-000001',
  'part.article': 'ART-100',
  'part.quantity': '1',
  'part.unitName': 'шт',
  'part.price': '1200.00',
  'line.name': 'Уплотнитель канала',
  'line.code': 'INV-000001',
  'line.article': 'ART-100',
  'line.quantity': '2',
  'line.unitName': 'шт',
  'line.price': '1500.00',
  'line.amount': '3000.00',
}

export const SAMPLE_PARTS: Record<string, string>[] = [
  {
    'part.name': 'Уплотнитель канала',
    'part.code': 'INV-000001',
    'part.article': 'ART-100',
    'part.quantity': '1',
    'part.unitName': 'шт',
    'part.price': '1200.00',
  },
  {
    'part.name': 'Клапан аспирации',
    'part.code': 'INV-000014',
    'part.article': 'ART-214',
    'part.quantity': '1',
    'part.unitName': 'шт',
    'part.price': '850.00',
  },
]

export const SAMPLE_LINES: Record<string, string>[] = [
  {
    'line.name': 'Уплотнитель канала',
    'line.code': 'INV-000001',
    'line.article': 'ART-100',
    'line.quantity': '2',
    'line.unitName': 'шт',
    'line.price': '1500.00',
    'line.amount': '3000.00',
  },
]
