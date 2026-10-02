import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SelectionBulkBar } from '@/components/shared/SelectionBulkBar'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatInteger } from '@/lib/utils/number'

import {
  useDeleteInventoryReceipt,
  type InventoryReceiptDeleteMode,
} from '../hooks/use-inventory'

type ReceiptBulkActionsProps = {
  selectedIds: string[]
  onClear: () => void
}

export function ReceiptBulkActions({ selectedIds, onClear }: ReceiptBulkActionsProps) {
  const count = selectedIds.length
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const remove = useDeleteInventoryReceipt()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState<InventoryReceiptDeleteMode | null>(null)

  if (count === 0 || !canReceive) {
    return null
  }

  async function runDelete(mode: InventoryReceiptDeleteMode) {
    setPendingMode(mode)
    try {
      for (const id of selectedIds) {
        await remove.mutateAsync({ id, mode })
      }
      toast.success(
        mode === 'hide'
          ? count === 1
            ? 'Запись прихода скрыта'
            : `Скрыто записей: ${formatInteger(count)}`
          : count === 1
            ? 'Приход отменён'
            : `Отменено приходов: ${formatInteger(count)}`,
      )
      setDeleteOpen(false)
      onClear()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPendingMode(null)
    }
  }

  return (
    <>
      <SelectionBulkBar count={count} onClear={onClear} pending={Boolean(pendingMode)}>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="text-destructive hover:text-destructive"
          aria-label="Удалить"
          disabled={Boolean(pendingMode)}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-4" />
        </Button>
      </SelectionBulkBar>

      <ConfirmDialog
        open={deleteOpen}
        title="Отменить приходы?"
        description={
          count === 1
            ? '«Отменить приход» убирает товар со склада (если он ещё не израсходован). «Скрыть запись» только убирает документ из списка.'
            : `Выбрано документов: ${formatInteger(count)}. «Отменить» списывает остаток, «Скрыть» только убирает из списка.`
        }
        cancelLabel="Закрыть"
        confirmLabel="Отменить приходы"
        extraAction={{
          label: 'Скрыть записи',
          variant: 'outline',
          isPending: pendingMode === 'hide',
          onClick: () => void runDelete('hide'),
        }}
        isPending={pendingMode === 'reverse'}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void runDelete('reverse')}
      />
    </>
  )
}
