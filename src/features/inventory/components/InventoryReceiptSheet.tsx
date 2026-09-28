import { Briefcase } from 'lucide-react'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useOpenEntitySheet } from '@/app/sheet-stack'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { ReceiptDeleteControl } from './ReceiptDeleteControl'
import { useInventoryReceipt } from '../hooks/use-inventory'
import type { InventoryReceiptLine } from '../services/inventory-service'

const cellPad = 'px-2 py-1.5'

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
              <ReceiptLinesTable lines={receipt.lines} />
            )}
          </div>
        )}
      </div>
    </SheetContent>
  )
}

function ReceiptLinesTable({ lines }: { lines: InventoryReceiptLine[] }) {
  const openSheet = useOpenEntitySheet()

  return (
    <div className="overflow-x-auto">
      <Table className="table-fixed">
        <colgroup>
          <col style={{ width: '2rem' }} />
          <col />
          <col style={{ width: '5.5rem' }} />
          <col style={{ width: '5.75rem' }} />
          <col style={{ width: '5.5rem' }} />
        </colgroup>
        <TableHeader>
          <TableRow className="border-b hover:bg-transparent">
            <TableHead className={cn(cellPad, 'h-8')} aria-hidden />
            <TableHead className={cn(cellPad, 'h-8 text-xs font-medium text-muted-foreground')}>
              Наименование
            </TableHead>
            <TableHead className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}>
              Цена, ₽
            </TableHead>
            <TableHead
              className={cn(cellPad, 'h-8 pr-5 text-right text-xs font-medium text-muted-foreground')}
            >
              Кол-во
            </TableHead>
            <TableHead className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}>
              Сумма, ₽
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const amount = line.quantity * line.unitPrice
            const meta = [line.itemCode, line.itemArticle].filter(Boolean).join(' ')
            const usageHint =
              line.remainingQuantity <= 0
                ? 'израсходовано'
                : line.remainingQuantity < line.quantity
                  ? `осталось ${formatQuantity(line.remainingQuantity)}`
                  : null
            const subtitle = [meta, usageHint].filter(Boolean).join(' ')

            return (
              <TableRow
                key={line.id}
                className="cursor-pointer border-b last:border-b-0 hover:bg-muted/20"
                onClick={() => openSheet('item', line.itemId)}
              >
                <TableCell className={cn(cellPad, 'w-8 text-muted-foreground')}>
                  <Briefcase className="size-3.5 opacity-70" aria-hidden />
                  <span className="sr-only">Товар</span>
                </TableCell>
                <TableCell className={cn(cellPad, 'max-w-0 whitespace-normal')}>
                  <div className="flex min-w-0 max-w-full items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-primary">{line.itemName}</span>
                    {subtitle ? (
                      <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:inline">
                        {subtitle}
                      </span>
                    ) : null}
                  </div>
                  {subtitle ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground sm:hidden">{subtitle}</p>
                  ) : null}
                </TableCell>
                <TableCell className={cn(cellPad, 'text-right text-sm tabular-nums')}>
                  {formatMoney(line.unitPrice)}
                </TableCell>
                <TableCell className={cn(cellPad, 'text-right text-sm tabular-nums')}>
                  {formatQuantity(line.quantity)}
                </TableCell>
                <TableCell className={cn(cellPad, 'text-right text-sm tabular-nums')}>
                  {formatMoney(amount)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
