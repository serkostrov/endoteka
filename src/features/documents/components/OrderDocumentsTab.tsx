import { DocumentSourceType } from '@/lib/constants/documents'

import { SourceDocumentsTab } from './SourceDocumentsTab'

type OrderDocumentsTabProps = {
  orderId: string
  orderNumber: string
}

export function OrderDocumentsTab({ orderId, orderNumber }: OrderDocumentsTabProps) {
  return (
    <SourceDocumentsTab
      sourceType={DocumentSourceType.Order}
      sourceId={orderId}
      sourceLabel={orderNumber}
      description="Акты и этикетки по этому заказу."
      emptyDescription="Создайте акт или этикетку из шаблона."
      deniedDescription="Недостаточно прав для документов заказа."
    />
  )
}
