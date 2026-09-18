import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type FilterBarProps = {
  children: ReactNode
  end?: ReactNode
  className?: string
}

export function FilterBar({ children, end, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto',
        '[&_[data-slot=input]]:h-9',
        '[&_[data-slot=select-trigger]]:h-9!',
        '[&_[data-slot=select-trigger]]:shrink-0',
        '[&>button]:h-9!',
        '[&>button]:shrink-0',
        '[&>[data-slot=search-input]]:min-w-[12rem] [&>[data-slot=search-input]]:flex-1 [&>[data-slot=search-input]]:max-w-none',
        className,
      )}
    >
      {children}
      {end ? <div className="ml-auto flex shrink-0 items-center gap-2">{end}</div> : null}
    </div>
  )
}
