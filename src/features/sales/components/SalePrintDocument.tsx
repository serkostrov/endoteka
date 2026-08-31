import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { APP_NAME } from '@/lib/constants/app'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { saleStatusLabels, saleStatusTone } from '@/lib/constants/sales'
import { formatDate } from '@/lib/utils/date'

import type { SaleDocument } from '../services/sales-service'

export function SalePrintDocument({ document }: { document: SaleDocument }) {
  return (
    <article className="mx-auto max-w-3xl space-y-6 bg-white text-black print:max-w-none">
      <header className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-sm text-neutral-600">{APP_NAME}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Счёт {document.invoiceNumber}</h1>
        </div>
        <StatusBadge tone={saleStatusTone(document.status)}>{saleStatusLabels[document.status]}</StatusBadge>
      </header>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-neutral-600">Покупатель</dt>
          <dd className="font-medium">{document.customerName || '—'}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">Дата</dt>
          <dd>{formatDate(document.saleDate)}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">ИНН</dt>
          <dd>{document.customerInn || '—'}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">Оформил</dt>
          <dd>{document.createdByName || '—'}</dd>
        </div>
      </dl>

      <DataTable
        caption="Позиции счёта"
        data={document.lines}
        getRowId={(row) => row.id}
        emptyTitle="Позиций нет"
        columns={[
          { id: 'item', header: 'Позиция', cell: (row) => `${row.itemName}${row.itemArticle ? ` · ${row.itemArticle}` : ''}` },
          { id: 'qty', header: 'Кол-во', cell: (row) => `${formatQuantity(row.quantity)} ${row.unitName}` },
          { id: 'price', header: 'Цена', cell: (row) => formatMoney(row.unitPrice) },
          { id: 'amount', header: 'Сумма', cell: (row) => formatMoney(row.amount) },
        ]}
      />

      <p className="text-right text-lg font-semibold">Итого: {formatMoney(document.total)}</p>

      {document.status === 'confirmed' && document.lines.some((line) => line.allocations.length > 0) ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Партии</h2>
          <ul className="space-y-1 text-sm">
            {document.lines.flatMap((line) =>
              line.allocations.map((allocation) => (
                <li key={allocation.id}>
                  {line.itemName}: {formatQuantity(allocation.quantity)} {line.unitName}
                  {allocation.receiptDate ? ` · партия ${formatDate(allocation.receiptDate)}` : ''}
                  {allocation.supplier ? ` · ${allocation.supplier}` : ''}
                </li>
              )),
            )}
          </ul>
        </section>
      ) : null}
    </article>
  )
}
