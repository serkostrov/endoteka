import type { MouseEvent, PointerEvent } from 'react'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type FilterClearButtonProps = {
  onClear: () => void
  label?: string
  className?: string
}

/** Крестик сброса внутри триггера фильтра — не открывает Select/Popover. */
export function FilterClearButton({
  onClear,
  label = 'Сбросить фильтр',
  className,
}: FilterClearButtonProps) {
  function stopOpen(event: PointerEvent | MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={label}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 [&_svg]:pointer-events-auto!',
        className,
      )}
      onPointerDown={stopOpen}
      onClick={(event) => {
        stopOpen(event)
        onClear()
      }}
    >
      <XIcon className="size-3.5" />
    </span>
  )
}
