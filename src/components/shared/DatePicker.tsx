import { useState, type Ref } from 'react'
import { CalendarDays } from 'lucide-react'

import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDate, parseDateInput, toDate, toIsoDate, toLocalDateTimeValue } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { TimePicker } from './TimePicker'

type DatePickerProps = {
  id?: string
  name?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  disabled?: boolean
  placeholder?: string
  allowClear?: boolean
  withTime?: boolean
  className?: string
  ref?: Ref<HTMLInputElement>
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

export function DatePicker({
  id,
  name,
  value,
  onChange,
  onBlur,
  disabled = false,
  placeholder = 'дд/мм/гггг',
  allowClear = true,
  withTime = false,
  className,
  ref,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: DatePickerProps) {
  const selected = value ? toDate(value) : null
  const formatted = selected ? formatDate(selected) : ''
  const timeValue = selected && withTime ? toLocalDateTimeValue(selected).slice(11, 16) : ''
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => selected ?? new Date())
  const [editing, setEditing] = useState<string | null>(null)
  const draft = editing ?? formatted

  function emit(next: Date | null) {
    if (!next) {
      onChange('')
      return
    }
    onChange(withTime ? toLocalDateTimeValue(next) : toIsoDate(next))
  }

  function commitDraft() {
    const parsed = parseDateInput(draft)
    if (!draft.trim()) {
      emit(null)
      setEditing(null)
      onBlur?.()
      return
    }
    if (parsed) {
      if (withTime) {
        const [hours, minutes] = (timeValue || '09:00').split(':').map(Number)
        parsed.setHours(hours || 0, minutes || 0, 0, 0)
      }
      emit(parsed)
    }
    setEditing(null)
    onBlur?.()
  }

  function selectDate(date: Date) {
    const next = new Date(date)
    if (withTime) {
      const [hours, minutes] = (timeValue || '09:00').split(':').map(Number)
      next.setHours(hours || 9, minutes || 0, 0, 0)
    }
    emit(next)
    setEditing(null)
    setOpen(false)
    onBlur?.()
  }

  function selectTime(nextTime: string) {
    if (!selected) {
      return
    }
    const [hours, minutes] = nextTime.split(':').map(Number)
    const next = new Date(selected)
    next.setHours(hours || 0, minutes || 0, 0, 0)
    emit(next)
  }

  return (
    <div className={cn('flex gap-2', className)}>
      <div className="relative min-w-0 flex-1">
        <Input
          ref={ref}
          id={id}
          name={name}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className="pr-9"
          onChange={(event) => setEditing(maskDateInput(event.target.value))}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitDraft()
            }
          }}
        />
        <Popover
          modal={false}
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (next) {
              setMonth(selected ?? new Date())
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label="Открыть календарь"
              className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onPointerDown={(event) => event.preventDefault()}
            >
              <CalendarDays />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="z-[80] w-auto p-3">
            <Calendar month={month} selected={selected} onMonthChange={setMonth} onSelect={selectDate} />
            <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
              {allowClear ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    emit(null)
                    setEditing(null)
                    setOpen(false)
                    onBlur?.()
                  }}
                >
                  Очистить
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (withTime) {
                    emit(new Date())
                    setEditing(null)
                    setOpen(false)
                    onBlur?.()
                    return
                  }
                  selectDate(new Date())
                }}
              >
                Сегодня
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {withTime ? (
        <TimePicker
          value={timeValue}
          disabled={disabled || !selected}
          onChange={selectTime}
          onBlur={onBlur}
        />
      ) : null}
    </div>
  )
}

function maskDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) {
    return digits
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}
