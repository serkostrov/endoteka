import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

type CalendarProps = {
  month: Date
  selected?: Date | null
  onMonthChange: (month: Date) => void
  onSelect: (date: Date) => void
}

export function Calendar({ month, selected, onMonthChange, onSelect }: CalendarProps) {
  const days = monthDays(month)

  return (
    <div className="w-70">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Предыдущий месяц"
          onClick={() => onMonthChange(addMonths(month, -1))}
        >
          <ChevronLeft />
        </Button>
        <p className="text-sm font-medium capitalize">{format(month, 'LLLL yyyy', { locale: ru })}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Следующий месяц"
          onClick={() => onMonthChange(addMonths(month, 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="mb-1 grid grid-cols-7 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((day) => (
          <span key={day} className="py-1 font-medium">
            {day}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day) => {
          const outside = !isSameMonth(day, month)
          const current = isToday(day)
          const active = selected ? isSameDay(day, selected) : false

          return (
            <button
              key={format(day, 'yyyy-MM-dd')}
              type="button"
              onClick={() => onSelect(day)}
              className={cn(
                'flex size-9 items-center justify-center rounded-full text-sm transition-colors',
                'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                outside && 'text-muted-foreground/45',
                current && !active && 'font-semibold text-primary ring-1 ring-primary/40',
                active && 'bg-primary font-medium text-primary-foreground hover:bg-primary hover:text-primary-foreground',
              )}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function monthDays(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days: Date[] = []
  let cursor = start
  while (cursor <= end) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}
