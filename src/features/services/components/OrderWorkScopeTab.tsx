import { OrderPartsTab } from '@/features/inventory'

import { OrderServicesBlock } from './OrderServicesBlock'

export function OrderWorkScopeTab({ orderId }: { orderId: string }) {
  return (
    <div className="space-y-4">
      <OrderPartsTab orderId={orderId} />
      <OrderServicesBlock orderId={orderId} />
    </div>
  )
}
