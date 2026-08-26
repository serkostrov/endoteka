import { useState, type Ref } from 'react'
import { CalendarDays } from 'lucide-react'

import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDate, parseDateInput, toIsoDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

type DatePickerProps = {
  id?: string
  name?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  disabled?: boolean
  placeholder?: string
  allowClear?: boolean
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
  className,
  ref,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: DatePickerProps) {
  const selected = value ? parseDateInput(value) : null
  const formatted = selected ? formatDate(selected) : ''
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => selected ?? new Date())
  const [editing, setEditing] = useState<string | null>(null)
  const draft = editing ?? formatted

  function commitDraft() {
    const parsed = parseDateInput(draft)
    if (!draft.trim()) {
      onChange('')
      setEditing(null)
      onBlur?.()
      return
    }
    if (parsed) {
      onChange(toIsoDate(parsed))
    }
    setEditing(null)
    onBlur?.()
  }

  function selectDate(date: Date) {
    onChange(toIsoDate(date))
    setEditing(null)
    setOpen(false)
    onBlur?.()
  }

  return (
    <div className={cn('relative', className)}>
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
                  onChange('')
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
            <Button type="button" variant="outline" size="sm" onClick={() => selectDate(new Date())}>
              Сегодня
            </Button>
          </div>
        </PopoverContent>
      </Popover>
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
