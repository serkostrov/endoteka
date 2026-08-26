import { LoaderCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

type LoadingStateProps = {
  label?: string
  className?: string
}

export function LoadingState({ label = 'Загрузка…', className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground', className)}
    >
      <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
