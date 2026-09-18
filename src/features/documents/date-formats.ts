import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

import { toDate } from '@/lib/utils/date'

export const DEFAULT_DOCUMENT_DATE_FORMAT = 'dd.MM.yyyy'

export const documentDateFormats = [
  { value: 'dd.MM.yyyy', label: '18.09.2026' },
  { value: 'dd.MM.yy', label: '18.09.26' },
  { value: 'dd/MM/yyyy', label: '18/09/2026' },
  { value: 'yyyy-MM-dd', label: '2026-09-18' },
  { value: 'd MMMM yyyy', label: '18 сентября 2026' },
  { value: 'dd.MM.yyyy HH:mm', label: '18.09.2026 14:30' },
] as const

export type DocumentDateFormat = (typeof documentDateFormats)[number]['value']

const STATIC_DATE_KEYS = new Set([
  'document.issuedAt',
  'order.createdAt',
  'order.deadline',
  'order.readyDate',
  'sale.date',
])

export function isDocumentDateKey(key: string, fieldType?: string) {
  if (fieldType === 'date') {
    return true
  }
  return STATIC_DATE_KEYS.has(key)
}

export function formatDocumentDate(value: string, dateFormat = DEFAULT_DOCUMENT_DATE_FORMAT) {
  const date = toDate(value)
  if (!date) {
    return value
  }
  try {
    return format(date, dateFormat, { locale: ru })
  } catch {
    return format(date, DEFAULT_DOCUMENT_DATE_FORMAT, { locale: ru })
  }
}

export function looksLikeIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(value.trim())
}
