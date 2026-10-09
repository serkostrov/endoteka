import { useState } from 'react'
import { Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatInteger } from '@/lib/utils/number'

import { useDeleteInventoryItem } from '../hooks/use-inventory'
import { printItemLabels, toPrintableItemLabel } from '../lib/print-item-labels'
import { getInventoryItemCard } from '../services/inventory-service'

type InventoryBulkActionsProps = {
  selectedIds: string[]
  onClear: () => void
}

export function InventoryBulkActions({ selectedIds, onClear }: InventoryBulkActionsProps) {
  const count = selectedIds.length
  const canDelete = useHasPermission(Permission.InventoryReceive)
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const canReadDocs = useHasPermission(Permission.DocumentsRead)
  const canCreateDocs = useHasPermission(Permission.DocumentsCreate)
  const canPrintDocs = useHasPermission(Permission.DocumentsPrint)
  const canPrint = canReceive || canReadDocs || canCreateDocs || canPrintDocs

  const remove = useDeleteInventoryItem()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [printPending, setPrintPending] = useState(false)

  if (count === 0) {
    return null
  }

  async function handleDelete() {
    try {
      for (const id of selectedIds) {
        await remove.mutateAsync(id)
      }
      toast.success(
        count === 1 ? 'Позиция удалена' : `Удалено позиций: ${formatInteger(count)}`,
      )
      setDeleteOpen(false)
      onClear()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handlePrint() {
    setPrintPending(true)
    try {
      const labels = []
      for (const id of selectedIds) {
        const card = await getInventoryItemCard(id)
        if (!card) {
          continue
        }
        labels.push(toPrintableItemLabel(card.item))
      }
      if (labels.length === 0) {
        toast.error('Не удалось загрузить позиции для печати')
        return
      }
      await printItemLabels(labels)
      toast.success(
        labels.length === 1
          ? 'Этикетка отправлена на печать'
          : `Этикеток отправлено: ${formatInteger(labels.length)}`,
      )
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPrintPending(false)
    }
  }

  return (
    <>
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur-sm">
        <p className="mr-1 text-sm font-medium">Выбрано: {formatInteger(count)}</p>

        {canPrint ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={printPending ? 'Подготовка…' : 'Распечатать этикетки'}
            disabled={printPending}
            onClick={() => void handlePrint()}
          >
            <Printer className="size-4" />
          </Button>
        ) : null}

        {canDelete ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            aria-label="Удалить"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}

        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Снять выбор
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Удалить позиции"
        description={
          count === 1
            ? 'Выбранная позиция будет удалена. Если по ней есть партии, движения или документы, удаление не пройдёт.'
            : `Будет удалено позиций: ${formatInteger(count)}. Удаление не пройдёт для позиций с партиями, движениями или документами.`
        }
        confirmLabel="Удалить"
        confirmVariant="destructive"
        isPending={remove.isPending}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}
