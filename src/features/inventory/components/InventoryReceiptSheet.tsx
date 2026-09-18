import { DataTable } from '@/components/shared/DataTable'
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

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(96vw,40rem)]"
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
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">
                Приход · <SupplierLink name={receipt.supplier} customerId={receipt.supplierId} />
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(receipt.receiptDate)}
                {receipt.notes ? ` · ${receipt.notes}` : ''}
              </p>
            </div>
            <DataTable
              caption="Строки прихода"
              data={receipt.lines}
              getRowId={(row) => row.id}
              emptyTitle="Строк нет"
              columns={[
                { id: 'name', header: 'Позиция', cell: (row) => row.itemName },
                { id: 'code', header: 'Код', cell: (row) => row.itemCode },
                { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(row.quantity) },
                { id: 'price', header: 'Цена', cell: (row) => formatMoney(row.unitPrice) },
                { id: 'left', header: 'Остаток партии', cell: (row) => formatQuantity(row.remainingQuantity) },
              ]}
            />
          </div>
        )}
      </div>
    </SheetContent>
  )
}
