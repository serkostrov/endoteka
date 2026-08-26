import { useId, type KeyboardEventHandler } from 'react'
import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type SearchInputProps = {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  className?: string
  disabled?: boolean
  onFocus?: () => void
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
}

export function SearchInput({
  value,
  onChange,
  label,
  placeholder = 'Поиск',
  className,
  disabled = false,
  onFocus,
  onKeyDown,
}: SearchInputProps) {
  const id = useId()

  return (
    <div className={cn('relative w-full min-w-0 max-w-sm', className)}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="h-9 pl-8"
        type="search"
        autoComplete="off"
      />
    </div>
  )
}
