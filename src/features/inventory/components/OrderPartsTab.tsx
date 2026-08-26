import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { DataTable } from '@/components/shared/DataTable'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useHasPermission } from '@/features/auth'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/utils/date'

import { BarcodeScanInput } from './BarcodeScanInput'
import { ItemSearchField } from './ItemSearchField'
import { useConsumeInventoryForOrder, useOrderInventoryUsage } from '../hooks/use-inventory'
import { findInventoryItemsByBarcode, type InventoryItem } from '../services/inventory-service'

type OrderPartsTabProps = {
  orderId: string
}

export function OrderPartsTab({ orderId }: OrderPartsTabProps) {
  const canWriteOff = useHasPermission(Permission.InventoryWriteOff)
  const usageQuery = useOrderInventoryUsage(orderId)
  const consume = useConsumeInventoryForOrder(orderId)
  const [picked, setPicked] = useState<InventoryItem | null>(null)
  const [quantity, setQuantity] = useState(1)
  const consumeInFlight = useRef(false)

  async function consumeItem(item: InventoryItem, qty: number) {
    if (consumeInFlight.current) {
      return
    }

    consumeInFlight.current = true
    try {
      await consume.mutateAsync({ itemId: item.id, quantity: qty })
      toast.success(`Списано: ${item.name}`)
      setPicked(null)
      setQuantity(1)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      consumeInFlight.current = false
    }
  }

  async function handleScan(code: string) {
    try {
      const items = await findInventoryItemsByBarcode(code)
      const match = items[0]
      if (items.length === 1 && match) {
        await consumeItem(match, 1)
        return
      }
      if (items.length === 0) {
        toast.error('Позиция со штрихкодом не найдена')
        return
      }
      if (match) {
        setPicked(match)
        toast.message('Найдено несколько позиций. Подтвердите списание.')
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <SectionCard
      title="Запчасти"
      description="Списание в заказ идёт FIFO по партиям, одной транзакцией. Остаток не может стать отрицательным."
    >
      {canWriteOff ? (
        <div className="mb-4 space-y-3 rounded-md border p-3">
          <BarcodeScanInput
            disabled={consume.isPending}
            autoFocus
            onScan={(code) => void handleScan(code)}
            placeholder="Считайте штрихкод — спишется 1 единица"
          />
          <ItemSearchField selected={picked} onSelect={setPicked} onClear={() => setPicked(null)} showScan={false} />
          {picked ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Количество</span>
                <Input
                  type="number"
                  min={0.001}
                  step="0.001"
                  className="w-28"
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </label>
              <Button
                type="button"
                disabled={consume.isPending || quantity <= 0}
                onClick={() => void consumeItem(picked, quantity)}
              >
                {consume.isPending ? 'Списание…' : 'Списать в заказ'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Сканер списывает сразу. Ручной поиск требует подтверждения количества.
            </p>
          )}
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">Нет права на списание со склада.</p>
      )}

      <DataTable
        caption="Списано в заказ"
        isLoading={usageQuery.isLoading}
        error={usageQuery.error ? getErrorMessage(usageQuery.error) : null}
        data={usageQuery.data ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Запчасти не списывались"
        emptyDescription="Списания появятся после работы со складом."
        columns={[
          { id: 'name', header: 'Позиция', cell: (row) => row.itemName },
          { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(Math.abs(row.quantity)) },
          { id: 'unit', header: 'Ед.', cell: (row) => row.unitName },
          { id: 'price', header: 'Цена партии', cell: (row) => formatMoney(row.unitPrice) },
          {
            id: 'batch',
            header: 'Партия',
            className: 'hidden md:table-cell',
            cell: (row) => `${formatDate(row.batchReceiptDate)} · ${row.batchSupplier || '—'}`,
          },
          {
            id: 'who',
            header: 'Кто',
            className: 'hidden lg:table-cell',
            cell: (row) => row.actorName || '—',
          },
          { id: 'when', header: 'Когда', cell: (row) => formatDateTime(row.createdAt) },
        ]}
      />
    </SectionCard>
  )
}
