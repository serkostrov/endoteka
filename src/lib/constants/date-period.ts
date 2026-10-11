import {
  addDays,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns'

import { formatDate, toDate, toIsoDate } from '@/lib/utils/date'

export const DatePeriodPreset = {
  All: 'all',
  Today: 'today',
  ThisWeek: 'this_week',
  ThisMonth: 'this_month',
  ThisYear: 'this_year',
  Yesterday: 'yesterday',
  LastWeek: 'last_week',
  LastMonth: 'last_month',
  LastYear: 'last_year',
  Custom: 'custom',
} as const

export type DatePeriodPreset = (typeof DatePeriodPreset)[keyof typeof DatePeriodPreset]

export const datePeriodPresetLabels: Record<DatePeriodPreset, string> = {
  all: 'За все время',
  today: 'Сегодня',
  this_week: 'Эта неделя',
  this_month: 'Этот месяц',
  this_year: 'Этот год',
  yesterday: 'Вчера',
  last_week: 'Прошлая неделя',
  last_month: 'Прошлый месяц',
  last_year: 'Прошлый год',
  custom: 'Выбрать даты',
}

export const datePeriodPrimaryPresets: DatePeriodPreset[] = [
  DatePeriodPreset.All,
  DatePeriodPreset.Today,
  DatePeriodPreset.ThisWeek,
  DatePeriodPreset.ThisMonth,
  DatePeriodPreset.ThisYear,
]

export const datePeriodPastPresets: DatePeriodPreset[] = [
  DatePeriodPreset.Yesterday,
  DatePeriodPreset.LastWeek,
  DatePeriodPreset.LastMonth,
  DatePeriodPreset.LastYear,
]

export function isDatePeriodPreset(value: string): value is DatePeriodPreset {
  return value in datePeriodPresetLabels
}

const weekOpts = { weekStartsOn: 1 as const }

/** Полуинтервал [from, toExclusive) в ISO для фильтра по timestamptz. */
export type DatePeriodBounds = {
  fromIso: string | null
  toExclusiveIso: string | null
}

export function resolveDatePeriodBounds(
  preset: DatePeriodPreset,
  customFrom: string | null = null,
  customTo: string | null = null,
  now = new Date(),
): DatePeriodBounds {
  if (preset === DatePeriodPreset.All) {
    return { fromIso: null, toExclusiveIso: null }
  }

  if (preset === DatePeriodPreset.Custom) {
    const fromDate = customFrom ? toDate(customFrom) : null
    const toDateValue = customTo ? toDate(customTo) : null
    if (!fromDate && !toDateValue) {
      return { fromIso: null, toExclusiveIso: null }
    }
    const start = fromDate ? startOfDay(fromDate) : null
    const end = toDateValue ? addDays(startOfDay(toDateValue), 1) : null
    if (start && end && start >= end) {
      return {
        fromIso: start.toISOString(),
        toExclusiveIso: addDays(start, 1).toISOString(),
      }
    }
    return {
      fromIso: start?.toISOString() ?? null,
      toExclusiveIso: end?.toISOString() ?? null,
    }
  }

  let start: Date
  let endExclusive: Date

  switch (preset) {
    case DatePeriodPreset.Today: {
      start = startOfDay(now)
      endExclusive = addDays(start, 1)
      break
    }
    case DatePeriodPreset.Yesterday: {
      start = startOfDay(subDays(now, 1))
      endExclusive = addDays(start, 1)
      break
    }
    case DatePeriodPreset.ThisWeek: {
      start = startOfWeek(now, weekOpts)
      endExclusive = addDays(startOfDay(endOfWeek(now, weekOpts)), 1)
      break
    }
    case DatePeriodPreset.LastWeek: {
      const prev = subWeeks(now, 1)
      start = startOfWeek(prev, weekOpts)
      endExclusive = addDays(startOfDay(endOfWeek(prev, weekOpts)), 1)
      break
    }
    case DatePeriodPreset.ThisMonth: {
      start = startOfMonth(now)
      endExclusive = addDays(startOfDay(endOfMonth(now)), 1)
      break
    }
    case DatePeriodPreset.LastMonth: {
      const prev = subMonths(now, 1)
      start = startOfMonth(prev)
      endExclusive = addDays(startOfDay(endOfMonth(prev)), 1)
      break
    }
    case DatePeriodPreset.ThisYear: {
      start = startOfYear(now)
      endExclusive = addDays(startOfDay(endOfYear(now)), 1)
      break
    }
    case DatePeriodPreset.LastYear: {
      const prev = subYears(now, 1)
      start = startOfYear(prev)
      endExclusive = addDays(startOfDay(endOfYear(prev)), 1)
      break
    }
    default:
      return { fromIso: null, toExclusiveIso: null }
  }

  return { fromIso: start.toISOString(), toExclusiveIso: endExclusive.toISOString() }
}

export function formatDatePeriodTriggerLabel(
  prefix: string,
  preset: DatePeriodPreset,
  customFrom: string | null = null,
  customTo: string | null = null,
): string {
  if (preset === DatePeriodPreset.Custom) {
    if (customFrom && customTo) {
      return `${prefix}: ${formatDate(customFrom)} – ${formatDate(customTo)}`
    }
    if (customFrom) {
      return `${prefix}: с ${formatDate(customFrom)}`
    }
    if (customTo) {
      return `${prefix}: по ${formatDate(customTo)}`
    }
    return `${prefix}: ${datePeriodPresetLabels.custom}`
  }
  return `${prefix}: ${datePeriodPresetLabels[preset]}`
}

export function normalizeCustomDateOrder(from: string, to: string): { from: string; to: string } {
  const fromDate = toDate(from)
  const toDateValue = toDate(to)
  if (!fromDate || !toDateValue || fromDate <= toDateValue) {
    return { from, to }
  }
  return { from: toIsoDate(toDateValue), to: toIsoDate(fromDate) }
}
