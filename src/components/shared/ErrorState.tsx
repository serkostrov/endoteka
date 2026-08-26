import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ErrorStateProps = {
  title?: string
  description: string
  onRetry?: () => void
  action?: ReactNode
  className?: string
}

export function ErrorState({
  title = 'Не удалось загрузить данные',
  description,
  onRetry,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border bg-card px-6 py-12 text-center',
        className,
      )}
    >
      <CircleAlert className="mb-4 size-10 text-destructive" aria-hidden="true" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button className="mt-6" type="button" variant="outline" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
