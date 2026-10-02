import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type EmptyStateProps = {
  title: string
  description: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
  /** Компактный вид для вложенных блоков в sheet/карточке. */
  size?: 'default' | 'compact'
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  size = 'default',
}: EmptyStateProps) {
  const compact = size === 'compact'

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed bg-card text-center',
        compact ? 'px-4 py-8' : 'px-6 py-12',
        className,
      )}
    >
      <div
        className={cn('text-muted-foreground', compact ? 'mb-2' : 'mb-4')}
        aria-hidden="true"
      >
        {icon ?? <Inbox className={compact ? 'size-7' : 'size-10'} />}
      </div>
      <h2 className={cn(compact ? 'text-sm font-semibold' : 'text-lg font-semibold')}>{title}</h2>
      <p
        className={cn(
          'max-w-md text-muted-foreground',
          compact ? 'mt-1 text-xs' : 'mt-2 text-sm',
        )}
      >
        {description}
      </p>
      {action ? <div className={cn(compact ? 'mt-4' : 'mt-6')}>{action}</div> : null}
    </div>
  )
}
