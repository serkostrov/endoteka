import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useHasPermission } from '@/features/auth'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils/date'

import { CreateItemDialog } from './CreateItemDialog'
import { InventoryItemSheet } from './InventoryItemScreen'
import { ItemSearchField } from './ItemSearchField'
import {
  useConsumeInventoryForOrder,
  useOrderInventoryUsage,
  useRemoveOrderPartLine,
  useSetOrderPartLine,
} from '../hooks/use-inventory'
import { findInventoryItemsByBarcode, type InventoryItem, type OrderInventoryUsage } from '../services/inventory-service'

type OrderPartsTabProps = {
  orderId: string
}

export function OrderPartsTab({ orderId }: OrderPartsTabProps) {
  const canWriteOff = useHasPermission(Permission.InventoryWriteOff)
  const canCreateItem = useHasPermission(Permission.InventoryReceive)
  const usageQuery = useOrderInventoryUsage(orderId)
  const consume = useConsumeInventoryForOrder(orderId)
  const [picked, setPicked] = useState<InventoryItem | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [unitPrice, setUnitPrice] = useState(0)
  const [openedItemId, setOpenedItemId] = useState<string | null>(null)
  const [createItemOpen, setCreateItemOpen] = useState(false)
  const [createQuery, setCreateQuery] = useState('')
  const consumeInFlight = useRef(false)
  const lines = usageQuery.data ?? []

  function pickItem(item: InventoryItem | null) {
    setPicked(item)
    setQuantity(1)
    setUnitPrice(item?.repairPrice ?? 0)
  }

  async function consumeItem(item: InventoryItem, qty: number, price: number) {
    if (consumeInFlight.current) {
      return
    }

    consumeInFlight.current = true
    try {
      await consume.mutateAsync({ itemId: item.id, quantity: qty, unitPrice: price })
      toast.success(`Добавлено: ${item.name}`)
      pickItem(null)
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
        await consumeItem(match, 1, match.repairPrice)
        return
      }
      if (items.length === 0) {
        toast.error('Позиция со штрихкодом не найдена')
        return
      }
      if (match) {
        pickItem(match)
        toast.message('Найдено несколько позиций. Подтвердите добавление.')
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleAdd() {
    if (!picked) {
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error('Количество должно быть больше нуля')
      return
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }
    await consumeItem(picked, quantity, unitPrice)
  }

  return (
    <SectionCard
      title="Запчасти"
      description="Количество и цена задаются для этого заказа. Списание со склада: сначала самые ранние поступления."
    >
      {canWriteOff ? (
        <div className="mb-4 space-y-3">
          <ItemSearchField
            selected={picked}
            disabled={consume.isPending}
            onSelect={pickItem}
            onClear={() => pickItem(null)}
            onBarcode={(code) => void handleScan(code)}
            allowCreate={canCreateItem}
            onCreateRequest={(query) => {
              setCreateQuery(query)
              setCreateItemOpen(true)
            }}
          />
          {picked ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-0.5">
                <Label htmlFor="order-part-qty" className="text-[11px] font-normal text-muted-foreground">
                  Кол-во
                </Label>
                <Input
                  id="order-part-qty"
                  type="number"
                  min={0.001}
                  step="0.001"
                  className="h-8 w-20 tabular-nums"
                  value={Number.isFinite(quantity) ? quantity : ''}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </div>
              <div className="space-y-0.5">
                <Label htmlFor="order-part-price" className="text-[11px] font-normal text-muted-foreground">
                  Цена
                </Label>
                <Input
                  id="order-part-price"
                  type="number"
                  min={0}
                  step="0.01"
                  className="h-8 w-24 tabular-nums"
                  value={Number.isFinite(unitPrice) ? unitPrice : ''}
                  onChange={(event) => setUnitPrice(Number(event.target.value))}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={consume.isPending}
                onClick={() => pickItem(null)}
              >
                Отменить
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={consume.isPending || quantity <= 0 || unitPrice < 0}
                onClick={() => void handleAdd()}
              >
                {consume.isPending ? 'Добавление…' : 'Добавить'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground mb-4 text-sm">Нет права на списание со склада.</p>
      )}

      {usageQuery.error ? (
        <ErrorState
          description={getErrorMessage(usageQuery.error)}
          onRetry={() => void usageQuery.refetch()}
          className="py-8"
        />
      ) : usageQuery.isLoading ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : lines.length === 0 ? (
        <EmptyState
          title="Запчасти не добавлялись"
          description="Найдите позицию и укажите количество и цену для этого заказа."
          className="py-8"
        />
      ) : (
        <ul className="grid gap-1.5">
          {lines.map((line) => (
            <li key={line.id}>
              <OrderPartCard
                line={line}
                orderId={orderId}
                canWriteOff={canWriteOff}
                onOpenItem={setOpenedItemId}
              />
            </li>
          ))}
        </ul>
      )}

      <InventoryItemSheet
        itemId={openedItemId}
        open={Boolean(openedItemId)}
        onOpenChange={(open) => {
          if (!open) {
            setOpenedItemId(null)
          }
        }}
      />
      <CreateItemDialog
        open={createItemOpen}
        onOpenChange={setCreateItemOpen}
        initialQuery={createQuery}
        onCreated={(item) => {
          pickItem(item)
          setCreateItemOpen(false)
        }}
      />
    </SectionCard>
  )
}

function OrderPartCard({
  line,
  orderId,
  canWriteOff,
  onOpenItem,
}: {
  line: OrderInventoryUsage
  orderId: string
  canWriteOff: boolean
  onOpenItem: (itemId: string) => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const remove = useRemoveOrderPartLine(orderId)
  const amount = line.quantity * line.unitPrice
  const meta = [line.itemCode, line.itemArticle].filter(Boolean).join(' · ')
  const unit = line.unitName || 'шт'
  const latestReceipt = line.batches.reduce<(typeof line.batches)[number] | null>((latest, batch) => {
    if (!latest || batch.receiptDate > latest.receiptDate) {
      return batch
    }
    return latest
  }, null)
  const latestReceiptText = latestReceipt
    ? [formatDate(latestReceipt.receiptDate), latestReceipt.supplier, `${formatQuantity(latestReceipt.quantity)} ${unit}`]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <article
      className="group cursor-pointer rounded-lg border bg-card px-2.5 py-2 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/50"
      onClick={() => onOpenItem(line.itemId)}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="min-w-0 truncate text-sm font-medium text-primary underline-offset-2 group-hover:underline">
              {line.itemName}
            </p>
            {meta ? <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{meta}</span> : null}
          </div>
          {meta ? <p className="truncate text-xs text-muted-foreground sm:hidden">{meta}</p> : null}
        </div>
        {canWriteOff ? (
          <IconActionButton
            label="Удалить из заказа"
            variant="ghost"
            size="icon-xs"
            className="-mt-0.5 -mr-1 shrink-0 text-destructive hover:text-destructive"
            disabled={remove.isPending}
            onClick={(event) => {
              event.stopPropagation()
              setDeleteOpen(true)
            }}
          >
            <Trash2 />
          </IconActionButton>
        ) : null}
      </div>

      <div
        className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <PartNumberField
          line={line}
          orderId={orderId}
          field="quantity"
          label="Кол-во"
          suffix={unit}
          disabled={!canWriteOff}
        />
        <PartNumberField
          line={line}
          orderId={orderId}
          field="unitPrice"
          label="Цена"
          suffix="₽"
          disabled={!canWriteOff}
        />
        <div className="min-w-16 space-y-0.5">
          <p className="text-[11px] leading-none text-muted-foreground">Сумма</p>
          <p className="flex h-7 items-center text-sm font-medium tabular-nums">{formatMoney(amount)} ₽</p>
        </div>
      </div>

      {latestReceiptText ? (
        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
          Последний приход: {latestReceiptText}
        </p>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить из заказа"
        description={`${line.itemName} вернётся на склад.`}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          remove.mutate(line.id, {
            onSuccess: () => {
              setDeleteOpen(false)
              toast.success('Запчасть удалена из заказа')
            },
            onError: (error) => toast.error(getErrorMessage(error)),
          })
        }}
      />
    </article>
  )
}

function PartNumberField({
  line,
  orderId,
  field,
  label,
  suffix,
  disabled,
}: {
  line: OrderInventoryUsage
  orderId: string
  field: 'quantity' | 'unitPrice'
  label: string
  suffix?: string
  disabled: boolean
}) {
  const setLine = useSetOrderPartLine(orderId)
  const current = field === 'quantity' ? line.quantity : line.unitPrice
  const fieldId = `${line.id}-${field}`

  function commit(raw: string) {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed === current) {
      return
    }
    if (field === 'quantity' && parsed <= 0) {
      toast.error('Количество должно быть больше нуля')
      return
    }
    if (field === 'unitPrice' && parsed < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }
    setLine.mutate(
      {
        lineId: line.id,
        quantity: field === 'quantity' ? parsed : line.quantity,
        unitPrice: field === 'unitPrice' ? parsed : line.unitPrice,
      },
      { onError: (error) => toast.error(getErrorMessage(error)) },
    )
  }

  const value =
    field === 'quantity' ? formatQuantity(current) : formatMoney(current)

  return (
    <div className="space-y-0.5">
      <Label htmlFor={fieldId} className="text-[11px] font-normal leading-none text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1">
        {disabled ? (
          <p id={fieldId} className="flex h-7 items-center text-sm tabular-nums">
            {field === 'quantity' ? value : `${value} ₽`}
          </p>
        ) : (
          <Input
            id={fieldId}
            key={`${line.id}-${field}-${current}`}
            type="number"
            min={field === 'quantity' ? 0.001 : 0}
            step={field === 'quantity' ? '0.001' : '0.01'}
            className="h-7 w-[4.75rem] px-2 tabular-nums"
            defaultValue={current}
            disabled={setLine.isPending}
            onBlur={(event) => commit(event.target.value)}
          />
        )}
        {suffix && !disabled ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  )
}
