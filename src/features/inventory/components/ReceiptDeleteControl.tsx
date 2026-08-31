import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { useDeleteInventoryReceipt, type InventoryReceiptDeleteMode } from '../hooks/use-inventory'

type ReceiptDeleteTarget = {
  id: string
  supplier: string
}

type ReceiptDeleteControlProps = {
  receipt: ReceiptDeleteTarget
  onDeleted?: () => void
  size?: 'icon' | 'icon-sm'
  variant?: 'icon' | 'button'
}

export function ReceiptDeleteControl({
  receipt,
  onDeleted,
  size = 'icon-sm',
  variant = 'icon',
}: ReceiptDeleteControlProps) {
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const remove = useDeleteInventoryReceipt()
  const [open, setOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState<InventoryReceiptDeleteMode | null>(null)

  if (!canReceive) {
    return null
  }

  async function runDelete(mode: InventoryReceiptDeleteMode) {
    setPendingMode(mode)
    try {
      await remove.mutateAsync({ id: receipt.id, mode })
      onDeleted?.()
      toast.success(mode === 'hide' ? 'Запись прихода скрыта' : 'Приход отменён, остаток уменьшен')
      setOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPendingMode(null)
    }
  }

  const trigger =
    variant === 'button' ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Удалить
      </Button>
    ) : (
      <IconActionButton
        label="Удалить"
        size={size}
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
      </IconActionButton>
    )

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {trigger}
      <ConfirmDialog
        open={open}
        title="Удалить приход?"
        description={`${receipt.supplier}: «Удалить запись» скроет документ без изменения остатка. «Удалить приход» спишет со склада всё, что пришло по этому документу (если позиции ещё не использованы).`}
        cancelLabel="Отменить"
        confirmLabel="Удалить приход"
        extraAction={{
          label: 'Удалить запись',
          variant: 'outline',
          isPending: pendingMode === 'hide',
          onClick: () => void runDelete('hide'),
        }}
        isPending={pendingMode === 'reverse'}
        onOpenChange={setOpen}
        onConfirm={() => void runDelete('reverse')}
      />
    </div>
  )
}
