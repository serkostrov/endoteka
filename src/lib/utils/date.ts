import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

/** Отображение даты в UI: 23.09.26 */
export const DATE_DISPLAY_FORMAT = 'dd.MM.yy'
export const DATE_DISPLAY_PLACEHOLDER = 'дд.мм.гг'
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

  const display = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(trimmed)
  if (display) {
    const year = expandYear(display[3]!)
    return localDate(year, Number(display[2]), Number(display[1]))
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

export function toLocalDateTimeValue(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}

export function localDateTimeToIso(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = parseDateInput(trimmed)
  return date ? date.toISOString() : null
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

/** дд.мм.гг при вводе; принимает и старые слэши. */
export function maskDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6)
  if (digits.length <= 2) {
    return digits
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}.${digits.slice(2)}`
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
}

function expandYear(raw: string): number {
  if (raw.length === 4) {
    return Number(raw)
  }
  const yy = Number(raw)
  // 00–99 → 2000–2099 (сроки гарантии / заказы в текущем веке)
  return 2000 + yy
}

function localDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}
