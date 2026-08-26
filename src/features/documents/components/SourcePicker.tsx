import { useState } from 'react'

import { SearchInput } from '@/components/shared/SearchInput'
import { Button } from '@/components/ui/button'
import { ItemSearchField } from '@/features/inventory/components/ItemSearchField'
import { useOrders } from '@/features/orders/hooks/use-orders'
import { useSales } from '@/features/sales/hooks/use-sales'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { DocumentSourceType, type DocumentSourceType as SourceType } from '@/lib/constants/documents'
import { SALES_SEARCH_DEBOUNCE_MS } from '@/lib/constants/sales'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

type SourcePickerProps = {
  sourceType: SourceType
  sourceId: string | null
  sourceLabel: string
  onChange: (next: { sourceId: string | null; sourceLabel: string }) => void
}

export function SourcePicker({ sourceType, sourceId, sourceLabel, onChange }: SourcePickerProps) {
  if (sourceType === DocumentSourceType.None) {
    return <p className="text-sm text-muted-foreground">Шаблон не требует объект.</p>
  }

  if (sourceType === DocumentSourceType.Item) {
    if (sourceId) {
      return (
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
          <p className="text-sm font-medium">{sourceLabel || sourceId}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ sourceId: null, sourceLabel: '' })}>
            Сменить
          </Button>
        </div>
      )
    }
    return (
      <ItemSearchField
        onSelect={(item) => onChange({ sourceId: item.id, sourceLabel: item.name })}
        showScan={false}
      />
    )
  }

  if (sourceType === DocumentSourceType.Sale) {
    return <SaleSourcePicker sourceId={sourceId} sourceLabel={sourceLabel} onChange={onChange} />
  }

  return <OrderSourcePicker sourceId={sourceId} sourceLabel={sourceLabel} onChange={onChange} />
}

function OrderSourcePicker({
  sourceId,
  sourceLabel,
  onChange,
}: {
  sourceId: string | null
  sourceLabel: string
  onChange: (next: { sourceId: string | null; sourceLabel: string }) => void
}) {
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 300)
  const ordersQuery = useOrders({
    search: debounced,
    statusId: 'all',
    responsibleId: 'all',
    deadlineState: 'all',
    activeOnly: false,
    attentionOnly: false,
    sort: 'updated',
    direction: 'desc',
    page: 1,
    pageSize: 8,
  })

  if (sourceId) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
        <p className="text-sm font-medium">{sourceLabel || sourceId}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ sourceId: null, sourceLabel: '' })}>
          Сменить
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <SearchInput value={query} onChange={setQuery} label="Поиск заказа" placeholder="Номер, клиент или серийный номер" />
      {ordersQuery.error ? <p className="text-sm text-destructive">{getErrorMessage(ordersQuery.error)}</p> : null}
      <ul className="divide-y rounded-md border">
        {(ordersQuery.data?.items ?? []).map((order) => (
          <li key={order.id}>
            <button
              type="button"
              className={cn('flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent')}
              onClick={() => onChange({ sourceId: order.id, sourceLabel: order.number })}
            >
              <span className="font-medium">{order.number}</span>
              <span className="text-xs text-muted-foreground">
                {order.customerName} · {order.serialNumber}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SaleSourcePicker({
  sourceId,
  sourceLabel,
  onChange,
}: {
  sourceId: string | null
  sourceLabel: string
  onChange: (next: { sourceId: string | null; sourceLabel: string }) => void
}) {
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, SALES_SEARCH_DEBOUNCE_MS)
  const salesQuery = useSales(debounced, 'all', 1, 8)

  if (sourceId) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
        <p className="text-sm font-medium">{sourceLabel || sourceId}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ sourceId: null, sourceLabel: '' })}>
          Сменить
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <SearchInput value={query} onChange={setQuery} label="Поиск продажи" placeholder="Номер счёта или покупатель" />
      {salesQuery.error ? <p className="text-sm text-destructive">{getErrorMessage(salesQuery.error)}</p> : null}
      <ul className="divide-y rounded-md border">
        {(salesQuery.data?.items ?? []).map((sale) => (
          <li key={sale.id}>
            <button
              type="button"
              className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => onChange({ sourceId: sale.id, sourceLabel: sale.invoiceNumber })}
            >
              <span className="font-medium">{sale.invoiceNumber}</span>
              <span className="text-xs text-muted-foreground">{sale.customerName || 'Без покупателя'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
