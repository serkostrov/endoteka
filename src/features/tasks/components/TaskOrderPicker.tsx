import { useState } from 'react'

import { SearchInput } from '@/components/shared/SearchInput'
import { Button } from '@/components/ui/button'
import { useOrders } from '@/features/orders/hooks/use-orders'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { TASK_SEARCH_DEBOUNCE_MS } from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'

type TaskOrderPickerProps = {
  orderId: string | null
  orderNumber: string
  onChange: (next: { orderId: string | null; orderNumber: string }) => void
}

export function TaskOrderPicker({ orderId, orderNumber, onChange }: TaskOrderPickerProps) {
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, TASK_SEARCH_DEBOUNCE_MS)
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

  if (orderId) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
        <p className="text-sm font-medium">{orderNumber || orderId}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ orderId: null, orderNumber: '' })}>
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
              className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => onChange({ orderId: order.id, orderNumber: order.number })}
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
