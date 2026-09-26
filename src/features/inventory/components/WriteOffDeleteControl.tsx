import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { useDeleteInventoryWriteOff, type InventoryWriteOffDeleteMode } from '../hooks/use-inventory'

type WriteOffDeleteTarget = {
  id: string
  reason: string
}

type WriteOffDeleteControlProps = {
  writeOff: WriteOffDeleteTarget
  onDeleted?: () => void
  size?: 'icon' | 'icon-sm'
  variant?: 'icon' | 'button'
}

export function WriteOffDeleteControl({
  writeOff,
  onDeleted,
  size = 'icon-sm',
  variant = 'icon',
}: WriteOffDeleteControlProps) {
  const canWriteOff = useHasPermission(Permission.InventoryWriteOff)
  const remove = useDeleteInventoryWriteOff()
  const [open, setOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState<InventoryWriteOffDeleteMode | null>(null)

  if (!canWriteOff) {
    return null
  }

  async function runDelete(mode: InventoryWriteOffDeleteMode) {
    setPendingMode(mode)
    try {
      await remove.mutateAsync({ id: writeOff.id, mode })
      onDeleted?.()
      toast.success(mode === 'hide' ? 'Запись списания скрыта' : 'Списание отменено, остаток возвращён')
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

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {trigger}
      <ConfirmDialog
        open={open}
        title="Удалить списание?"
        description={`${writeOff.reason}: «Удалить запись» скроет документ без изменения остатка. «Отменить списание» вернёт количество на склад.`}
        cancelLabel="Отменить"
        confirmLabel="Отменить списание"
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
