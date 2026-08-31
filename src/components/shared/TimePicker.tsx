import { useLayoutEffect, useRef, useState, type Ref } from 'react'
import { Clock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const HOURS = Array.from({ length: 24 }, (_, index) => index)
const MINUTE_STEP = 5

type TimePickerProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  disabled?: boolean
  placeholder?: string
  className?: string
  ref?: Ref<HTMLInputElement>
  'aria-label'?: string
}

export function TimePicker({
  id,
  value,
  onChange,
  onBlur,
  disabled = false,
  placeholder = 'чч:мм',
  className,
  ref,
  'aria-label': ariaLabel = 'Время',
}: TimePickerProps) {
  const parsed = parseTime(value)
  const formatted = parsed ? formatTime(parsed.hours, parsed.minutes) : ''
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const draft = editing ?? formatted

  function emit(hours: number, minutes: number) {
    onChange(formatTime(hours, minutes))
  }

  function commitDraft() {
    const next = parseTimeInput(draft)
    if (next) {
      onChange(next)
    }
    setEditing(null)
    onBlur?.()
  }

  function selectHour(hours: number) {
    emit(hours, parsed?.minutes ?? 0)
    setEditing(null)
  }

  function selectMinute(minutes: number) {
    emit(parsed?.hours ?? 9, minutes)
    setEditing(null)
  }

  function selectNow() {
    const now = new Date()
    emit(now.getHours(), now.getMinutes())
    setEditing(null)
    setOpen(false)
    onBlur?.()
  }

  return (
    <div className={cn('relative w-[6.75rem] shrink-0', className)}>
      <Input
        ref={ref}
        id={id}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        className="pr-9 tabular-nums"
        onChange={(event) => setEditing(maskTimeInput(event.target.value))}
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
          if (disabled) {
            return
          }
          setOpen(next)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label="Открыть время"
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onPointerDown={(event) => event.preventDefault()}
          >
            <Clock />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="z-[80] w-auto p-3">
          <div className="flex gap-2">
            <TimeColumn
              label="Часы"
              items={HOURS}
              selected={parsed?.hours ?? null}
              onSelect={selectHour}
            />
            <TimeColumn
              label="Минуты"
              items={minuteOptions(parsed?.minutes ?? null)}
              selected={parsed?.minutes ?? null}
              onSelect={selectMinute}
            />
          </div>
          <div className="mt-3 flex justify-end border-t pt-3">
            <Button type="button" variant="outline" size="sm" onClick={selectNow}>
              Сейчас
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function TimeColumn({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string
  items: number[]
  selected: number | null
  onSelect: (value: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const list = listRef.current
    const item = selectedRef.current
    if (!list || !item) {
      return
    }
    list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2
  }, [selected, items])

  return (
    <div className="w-16">
      <p className="mb-1.5 text-center text-xs font-medium text-muted-foreground">{label}</p>
      <div ref={listRef} className="max-h-52 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = selected === item
            return (
              <button
                key={item}
                ref={active ? selectedRef : undefined}
                type="button"
                onClick={() => onSelect(item)}
                className={cn(
                  'flex h-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors',
                  'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                  active &&
                    'bg-primary font-medium text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                )}
              >
                {String(item).padStart(2, '0')}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function minuteOptions(current: number | null): number[] {
  const items: number[] = []
  for (let minute = 0; minute < 60; minute += MINUTE_STEP) {
    items.push(minute)
  }
  if (current != null && !items.includes(current)) {
    items.push(current)
    items.sort((left, right) => left - right)
  }
  return items
}

function parseTime(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) {
    return null
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) {
    return null
  }
  return { hours, minutes }
}

function parseTimeInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  const withColon = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed)
  if (withColon) {
    return normalizeTime(Number(withColon[1]), Number(withColon[2]))
  }

  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 3) {
    return normalizeTime(Number(digits[0]), Number(digits.slice(1)))
  }
  if (digits.length === 4) {
    return normalizeTime(Number(digits.slice(0, 2)), Number(digits.slice(2)))
  }
  return null
}

function normalizeTime(hours: number, minutes: number): string | null {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null
  }
  return formatTime(hours, minutes)
}

function formatTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function maskTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) {
    return digits
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}
