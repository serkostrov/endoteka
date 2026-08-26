import { DocumentSourceType } from '@/lib/constants/documents'

import { SourceDocumentsTab } from './SourceDocumentsTab'

type SaleDocumentsTabProps = {
  saleId: string
  invoiceNumber: string
}

export function SaleDocumentsTab({ saleId, invoiceNumber }: SaleDocumentsTabProps) {
  return (
    <SourceDocumentsTab
      sourceType={DocumentSourceType.Sale}
      sourceId={saleId}
      sourceLabel={invoiceNumber}
      description="Накладная и этикетки по этому счёту. Печать черновика счёта — кнопкой «Печать»."
      emptyDescription="Создайте накладную из шаблона."
      deniedDescription="Недостаточно прав для документов продажи."
    />
  )
}
