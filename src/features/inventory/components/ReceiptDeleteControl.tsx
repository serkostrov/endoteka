import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { InventoryReceiptStatus } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { useDeleteInventoryReceipt, type InventoryReceiptDeleteMode } from '../hooks/use-inventory'

type ReceiptDeleteTarget = {
  id: string
  supplier: string
  status?: string
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
  const isDraft = receipt.status === InventoryReceiptStatus.Draft

  if (!canReceive) {
    return null
  }

  async function runDelete(mode: InventoryReceiptDeleteMode) {
    setPendingMode(mode)
    try {
      await remove.mutateAsync({ id: receipt.id, mode })
      onDeleted?.()
      toast.success(
        isDraft
          ? 'Черновик удалён'
          : mode === 'hide'
            ? 'Запись прихода скрыта (остаток не изменён)'
            : 'Приход отменён, товар списан со склада',
      )
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
        variant="ghost"
        size={size}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
      </IconActionButton>
    )

  const supplierLabel = receipt.supplier || 'без поставщика'

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {trigger}
      {isDraft ? (
        <ConfirmDialog
          open={open}
          title="Удалить черновик?"
          description={`${supplierLabel}: черновик будет удалён без изменений на складе.`}
          cancelLabel="Отмена"
          confirmLabel="Удалить"
          isPending={pendingMode === 'reverse'}
          onOpenChange={setOpen}
          onConfirm={() => void runDelete('reverse')}
        />
      ) : (
        <ConfirmDialog
          open={open}
          title="Отменить приход?"
          description={`${supplierLabel}: «Отменить приход» убирает товар со склада (если он ещё не израсходован). «Скрыть запись» только убирает документ из списка, остаток не меняется.`}
          cancelLabel="Закрыть"
          confirmLabel="Отменить приход"
          extraAction={{
            label: 'Скрыть запись',
            variant: 'outline',
            isPending: pendingMode === 'hide',
            onClick: () => void runDelete('hide'),
          }}
          isPending={pendingMode === 'reverse'}
          onOpenChange={setOpen}
          onConfirm={() => void runDelete('reverse')}
        />
      )}
    </div>
  )
}
