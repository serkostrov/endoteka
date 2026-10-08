import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type KeepAliveTabProps = {
  active: boolean
  children: ReactNode
  className?: string
}

/**
 * Вкладка остаётся смонтированной при переключении — локальный draft/форма не сбрасываются.
 * Неактивная панель скрыта и недоступна для взаимодействия (inert).
 */
export function KeepAliveTab({ active, children, className }: KeepAliveTabProps) {
  return (
    <div
      className={cn(!active && 'hidden', className)}
      aria-hidden={!active}
      inert={!active ? true : undefined}
    >
      {children}
    </div>
  )
}
