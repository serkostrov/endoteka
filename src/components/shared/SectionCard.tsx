import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type SectionCardProps = {
  title?: ReactNode
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Без внешней рамки — для секций внутри уже оформленной карточки. */
  flat?: boolean
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  flat = false,
}: SectionCardProps) {
  const hasHeader = title != null || Boolean(description) || Boolean(actions)

  if (flat) {
    return (
      <section className={cn('space-y-3', className)}>
        {hasHeader ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              {title != null ? <h2 className="text-base font-semibold tracking-tight">{title}</h2> : null}
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </section>
    )
  }

  return (
    <Card className={cn('shadow-none', className)}>
      {hasHeader ? (
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0">
            {title != null ? <CardTitle className="text-base">{title}</CardTitle> : null}
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  )
}
