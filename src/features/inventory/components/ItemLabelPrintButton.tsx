import { useState } from 'react'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'

import { IconActionButton } from '@/components/shared/IconActionButton'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { useItemLabelPrint } from '../lib/item-label-print-context'
import { printItemLabels, toPrintableItemLabel, type PrintableItemLabel } from '../lib/print-item-labels'

type ItemLabelPrintButtonProps = {
  /** Запасной снимок, если форма ещё не зарегистрировала превью (например, только чтение). */
  fallback?: PrintableItemLabel
}

export function ItemLabelPrintButton({ fallback }: ItemLabelPrintButtonProps) {
  const labelPrint = useItemLabelPrint()
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const canReadDocs = useHasPermission(Permission.DocumentsRead)
  const canCreateDocs = useHasPermission(Permission.DocumentsCreate)
  const canPrintDocs = useHasPermission(Permission.DocumentsPrint)
  const canPrint = canReceive || canReadDocs || canCreateDocs || canPrintDocs
  const [pending, setPending] = useState(false)

  if (!canPrint) {
    return null
  }

  async function handlePrint() {
    const snapshot = labelPrint?.getSnapshot() ?? (fallback ? toPrintableItemLabel(fallback) : null)
    if (!snapshot) {
      toast.error('Нет данных для этикетки')
      return
    }

    setPending(true)
    try {
      await printItemLabels([snapshot])
      toast.success('Этикетка отправлена на печать')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <IconActionButton
      label={pending ? 'Подготовка…' : 'Распечатать этикетку'}
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      onClick={() => void handlePrint()}
    >
      <Printer />
    </IconActionButton>
  )
}
