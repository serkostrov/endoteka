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
        'flex flex-wrap items-end gap-2',
        '[&_[data-slot=input]]:h-9',
        '[&_[data-slot=select-trigger]]:h-9!',
        '[&>button]:h-9!',
        className,
      )}
    >
      {children}
      {end ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
    </div>
  )
}
