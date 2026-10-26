import { DataTable } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetExitPresence,
} from '@/components/ui/sheet'
import {
  formatMoney,
  formatQuantity,
  InventoryWriteOffStatus,
  inventoryWriteOffStatusLabels,
  inventoryWriteOffStatusTone,
} from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils/date'

import { WriteOffDeleteControl } from './WriteOffDeleteControl'
import { useInventoryWriteOff } from '../hooks/use-inventory'

export function InventoryWriteOffSheet({
  writeOffId,
  open,
  onOpenChange,
}: {
  writeOffId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const presence = useSheetExitPresence(open, writeOffId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? (
        <InventoryWriteOffSheetContent
          key={presence.id}
          writeOffId={presence.id}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Sheet>
  )
}

function InventoryWriteOffSheetContent({
  writeOffId,
  onClose,
}: {
  writeOffId: string
  onClose: () => void
}) {
  const writeOffQuery = useInventoryWriteOff(writeOffId)
  const writeOff = writeOffQuery.data
  const total = writeOff?.lines.reduce((sum, line) => sum + line.amount, 0) ?? 0

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(96vw,56rem)]"
      actions={
        writeOff ? (
          <WriteOffDeleteControl
            writeOff={{ id: writeOff.id, reason: writeOff.reason, status: writeOff.status }}
            onDeleted={onClose}
          />
        ) : null
      }
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Списание</SheetTitle>
        <SheetDescription>Карточка списания. Список остаётся на фоне.</SheetDescription>
      </SheetHeader>
      <div className="space-y-4 p-4 pr-14">
        {writeOffQuery.isLoading ? (
          <LoadingState label="Загрузка списания" className="min-h-40" />
        ) : writeOffQuery.error ? (
          <ErrorState description={getErrorMessage(writeOffQuery.error)} />
        ) : !writeOff ? (
          <ErrorState description="Списание не найдено." />
        ) : writeOff.status === InventoryWriteOffStatus.Draft ? (
          <EmptyState
            title="Черновик списания"
            description="Откройте документ из списка, чтобы продолжить заполнение или провести."
            className="min-h-40 border-0 bg-transparent"
          />
        ) : (
          <div className="space-y-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{writeOff.reason || '—'}</h2>
                <StatusBadge tone={inventoryWriteOffStatusTone(writeOff.status)}>
                  {inventoryWriteOffStatusLabels[writeOff.status]}
                </StatusBadge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(writeOff.writeOffDate)}
                {writeOff.actorName ? ` ${writeOff.actorName}` : ''}
                {writeOff.notes ? ` ${writeOff.notes}` : ''}
              </p>
              <p className="mt-1 text-sm font-medium tabular-nums">Итого {formatMoney(total)} ₽</p>
            </div>
            <DataTable
              caption="Строки списания"
              data={writeOff.lines}
              getRowId={(row) => row.id}
              emptyTitle="Строк нет"
              columns={[
                {
                  id: 'name',
                  header: 'Позиция',
                  cell: (row) => (
                    <EntitySheetLink kind="item" id={row.itemId} className="font-medium">
                      {row.itemName}
                    </EntitySheetLink>
                  ),
                },
                { id: 'code', header: 'Код', cell: (row) => row.itemCode || '—' },
                {
                  id: 'qty',
                  header: 'Кол-во',
                  cell: (row) => `${formatQuantity(row.quantity)} ${row.unitName}`,
                },
                { id: 'price', header: 'Цена', cell: (row) => formatMoney(row.unitPrice) },
                { id: 'amount', header: 'Сумма', cell: (row) => formatMoney(row.amount) },
              ]}
            />
          </div>
        )}
      </div>
    </SheetContent>
  )
}
