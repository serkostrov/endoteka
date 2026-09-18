import type { ReactNode } from 'react'

import { PageNavControls } from '@/app/layouts/PageNavControls'
import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  titleExtra?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, titleExtra, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-1">
        <PageNavControls className="mt-0.5" />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {typeof title === 'string' ? (
              <h1 className="min-w-0 text-xl font-semibold tracking-tight">{title}</h1>
            ) : (
              <div className="min-w-0 flex-1">{title}</div>
            )}
            {titleExtra}
          </div>
          {description ? (
            typeof description === 'string' ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            ) : (
              <div className="mt-1 max-w-2xl">{description}</div>
            )
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
