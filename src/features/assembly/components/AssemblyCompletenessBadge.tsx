import { StatusBadge } from '@/components/shared/StatusBadge'

import { completenessTone, formatCompletenessPct } from '../lib/completeness'

export function AssemblyCompletenessBadge({
  pct,
  className,
}: {
  pct: number
  className?: string
}) {
  return (
    <StatusBadge tone={completenessTone(pct)} className={className}>
      {formatCompletenessPct(pct)}
    </StatusBadge>
  )
}
