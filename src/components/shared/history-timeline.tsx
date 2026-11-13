import { format, isSameYear, isToday, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { ReactNode } from 'react'

import { toDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

export type HistoryDayGroup<T> = {
  dayKey: string
  dayLabel: string
  items: T[]
}

export type HistoryMonthGroup<T> = {
  monthKey: string
  monthLabel: string
  days: HistoryDayGroup<T>[]
}

/** Группировка ленты: месяц+год → дни → события. */
export function groupHistoryByMonthAndDay<T>(
  items: T[],
  getCreatedAt: (item: T) => string | null | undefined,
): HistoryMonthGroup<T>[] {
  const months: HistoryMonthGroup<T>[] = []
  const now = new Date()

  for (const item of items) {
    const date = toDate(getCreatedAt(item) ?? null)
    const monthKey = date ? format(date, 'yyyy-MM') : 'unknown'
    const dayKey = date ? format(date, 'yyyy-MM-dd') : 'unknown'
    const monthLabel = date
      ? format(date, isSameYear(date, now) ? 'LLLL' : 'LLLL yyyy', { locale: ru })
      : 'Без даты'
    const dayLabel = date ? formatHistoryDayLabel(date, now) : 'Без даты'

    let month = months[months.length - 1]
    if (!month || month.monthKey !== monthKey) {
      month = { monthKey, monthLabel: capitalizeMonth(monthLabel), days: [] }
      months.push(month)
    }

    let day = month.days[month.days.length - 1]
    if (!day || day.dayKey !== dayKey) {
      day = { dayKey, dayLabel, items: [] }
      month.days.push(day)
    }

    day.items.push(item)
  }

  return months
}

function formatHistoryDayLabel(date: Date, now: Date) {
  if (isToday(date)) {
    return 'Сегодня'
  }
  if (isYesterday(date)) {
    return 'Вчера'
  }
  return format(date, 'd MMMM', { locale: ru })
}

function capitalizeMonth(value: string) {
  if (!value) {
    return value
  }
  return value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1)
}

export function HistoryMonthHeader({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 py-1', className)} role="separator" aria-label={label}>
      <div className="h-px min-w-4 flex-1 bg-border/80" />
      <span className="shrink-0 rounded-full bg-muted/70 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="h-px min-w-4 flex-1 bg-border/80" />
    </div>
  )
}

export function HistoryDayHeader({ label, className }: { label: string; className?: string }) {
  return (
    <h3
      className={cn(
        'mb-2 text-[11px] font-medium tracking-wide text-muted-foreground',
        className,
      )}
    >
      {label}
    </h3>
  )
}

export function HistoryMonthSections<T>({
  groups,
  renderDayItems,
  className,
}: {
  groups: HistoryMonthGroup<T>[]
  renderDayItems: (items: T[], dayKey: string) => ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-5', className)}>
      {groups.map((month) => (
        <section key={month.monthKey} className="space-y-3">
          <HistoryMonthHeader label={month.monthLabel} />
          <div className="space-y-4">
            {month.days.map((day) => (
              <section key={day.dayKey}>
                <HistoryDayHeader label={day.dayLabel} />
                {renderDayItems(day.items, day.dayKey)}
              </section>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
