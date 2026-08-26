import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

export const DATE_DISPLAY_FORMAT = 'dd/MM/yyyy'
export const DATE_ISO_FORMAT = 'yyyy-MM-dd'

export function parseDateInput(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (iso) {
    return localDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  }

  const display = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed)
  if (display) {
    return localDate(Number(display[3]), Number(display[2]), Number(display[1]))
  }

  return null
}

export function toDate(value: Date | string): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return parseDateInput(value)
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function toIsoDate(value: Date): string {
  return format(value, DATE_ISO_FORMAT)
}

export function formatDate(value: Date | string): string {
  const date = toDate(value)
  if (!date) {
    return '—'
  }
  return format(date, DATE_DISPLAY_FORMAT, { locale: ru })
}

export function formatDateTime(value: Date | string): string {
  const date = toDate(value)
  if (!date) {
    return '—'
  }
  return format(date, `${DATE_DISPLAY_FORMAT} HH:mm`, { locale: ru })
}

function localDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}
