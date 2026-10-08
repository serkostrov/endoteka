import { useState } from 'react'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'

import { IconActionButton } from '@/components/shared/IconActionButton'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { printItemLabels } from '../lib/print-item-labels'
import type { InventoryItem } from '../services/inventory-service'

type ItemLabelPrintButtonProps = {
  item: Pick<InventoryItem, 'name' | 'code' | 'barcode' | 'barcodeType'>
}

export function ItemLabelPrintButton({ item }: ItemLabelPrintButtonProps) {
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
    setPending(true)
    try {
      await printItemLabels([
        {
          name: item.name,
          code: item.code,
          barcode: item.barcode,
          barcodeType: item.barcodeType,
        },
      ])
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
