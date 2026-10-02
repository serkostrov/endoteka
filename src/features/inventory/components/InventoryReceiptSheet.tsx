import { Briefcase } from 'lucide-react'

import { useOpenEntitySheet } from '@/app/sheet-stack'
import { DataTable } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { SupplierLink } from '@/components/shared/SupplierLink'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetExitPresence,
} from '@/components/ui/sheet'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils/date'

import { ReceiptDeleteControl } from './ReceiptDeleteControl'
import { useInventoryReceipt } from '../hooks/use-inventory'
import type { InventoryReceiptLine } from '../services/inventory-service'

export function InventoryReceiptSheet({
  receiptId,
  open,
  onOpenChange,
}: {
  receiptId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const presence = useSheetExitPresence(open, receiptId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? (
        <InventoryReceiptSheetContent key={presence.id} receiptId={presence.id} onClose={() => onOpenChange(false)} />
      ) : null}
    </Sheet>
  )
}

function InventoryReceiptSheetContent({ receiptId, onClose }: { receiptId: string; onClose: () => void }) {
  const receiptQuery = useInventoryReceipt(receiptId)
  const receipt = receiptQuery.data
  const total = receipt?.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) ?? 0
  const openSheet = useOpenEntitySheet()

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(96vw,56rem)]"
      actions={
        receipt ? (
          <ReceiptDeleteControl receipt={{ id: receipt.id, supplier: receipt.supplier }} onDeleted={onClose} />
        ) : null
      }
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Приход</SheetTitle>
        <SheetDescription>Карточка прихода. Список остаётся на фоне.</SheetDescription>
      </SheetHeader>
      <div className="space-y-4 p-4 pr-14">
        {receiptQuery.isLoading ? (
          <LoadingState label="Загрузка прихода" className="min-h-40" />
        ) : receiptQuery.error ? (
          <ErrorState description={getErrorMessage(receiptQuery.error)} />
        ) : !receipt ? (
          <ErrorState description="Приход не найден." />
        ) : (
          <div className="space-y-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight">
                  Приход <SupplierLink name={receipt.supplier} customerId={receipt.supplierId} />
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDate(receipt.receiptDate)}
                  {receipt.actorName ? ` ${receipt.actorName}` : ''}
                  {receipt.notes ? ` ${receipt.notes}` : ''}
                </p>
              </div>
              <p className="shrink-0 text-sm tabular-nums">
                <span className="text-muted-foreground">Итого </span>
                <span className="font-semibold">{formatMoney(total)} ₽</span>
              </p>
            </div>

            {receipt.lines.length === 0 ? (
              <EmptyState
                title="Строк нет"
                description="В этом приходе нет позиций."
                className="border-0 bg-transparent py-8"
              />
            ) : (
              <DataTable
                caption="Строки прихода"
                data={receipt.lines}
                getRowId={(row) => row.id}
                onRowClick={(row) => openSheet('item', row.itemId)}
                columns={[
                  {
                    id: 'name',
                    header: 'Наименование',
                    className: 'min-w-[12rem]',
                    cell: (row) => <ReceiptLineName line={row} />,
                  },
                  {
                    id: 'price',
                    header: 'Цена, ₽',
                    className: 'w-[1%] text-right tabular-nums',
                    cell: (row) => formatMoney(row.unitPrice),
                  },
                  {
                    id: 'qty',
                    header: 'Кол-во',
                    className: 'w-[1%] text-right tabular-nums',
                    cell: (row) => formatQuantity(row.quantity),
                  },
                  {
                    id: 'amount',
                    header: 'Сумма, ₽',
                    className: 'w-[1%] text-right tabular-nums',
                    cell: (row) => formatMoney(row.quantity * row.unitPrice),
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>
    </SheetContent>
  )
}

function ReceiptLineName({ line }: { line: InventoryReceiptLine }) {
  const meta = [line.itemCode, line.itemArticle].filter(Boolean).join(' ')
  const usageHint =
    line.remainingQuantity <= 0
      ? 'израсходовано'
      : line.remainingQuantity < line.quantity
        ? `осталось ${formatQuantity(line.remainingQuantity)}`
        : null
  const subtitle = [meta, usageHint].filter(Boolean).join(' ')

  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Briefcase className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-70" aria-hidden />
      <div className="min-w-0">
        <p className="truncate font-medium text-primary">{line.itemName}</p>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  )
}
