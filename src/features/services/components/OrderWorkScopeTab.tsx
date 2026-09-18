import { SectionCard } from '@/components/shared/SectionCard'

import { OrderWorkCompositionSearch } from './OrderWorkCompositionSearch'
import { OrderWorkCompositionTable } from './OrderWorkCompositionTable'

export function OrderWorkScopeTab({ orderId }: { orderId: string }) {
  return (
    <SectionCard title="Состав работы" flat className="space-y-4">
      <OrderWorkCompositionSearch orderId={orderId} />
      <OrderWorkCompositionTable orderId={orderId} />
    </SectionCard>
  )
}
