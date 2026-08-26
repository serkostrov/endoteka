import { StatusBadge } from '@/components/shared/StatusBadge'
import { isWarrantyStatus, warrantyStatusLabels, type WarrantyStatus } from '@/lib/constants/devices'
import { formatDate } from '@/lib/utils/date'

import type { DeviceWarranty } from '../services/devices-service'

function warrantyTone(status: WarrantyStatus): 'success' | 'warning' | 'neutral' {
  if (status === 'active') {
    return 'success'
  }
  if (status === 'upcoming') {
    return 'warning'
  }
  return 'neutral'
}

export function WarrantyBadge({ warranty }: { warranty: DeviceWarranty | null }) {
  if (!warranty || !isWarrantyStatus(warranty.status)) {
    return <span className="text-muted-foreground">Нет гарантии</span>
  }

  return (
    <StatusBadge tone={warrantyTone(warranty.status)}>
      {`${warrantyStatusLabels[warranty.status]} · до ${formatDate(warranty.endsOn)}`}
    </StatusBadge>
  )
}
