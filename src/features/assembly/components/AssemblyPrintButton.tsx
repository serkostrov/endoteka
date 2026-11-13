import { Printer } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { printAssemblySheet } from '../lib/print-assembly-sheet'
import type { AssemblyDetail } from '../services/assembly-service'

export function AssemblyPrintButton({ assembly }: { assembly: AssemblyDetail }) {
  const canPrint =
    useHasPermission(Permission.DocumentsPrint) || useHasPermission(Permission.OrdersRead)

  if (!canPrint) {
    return null
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void printAssemblySheet(assembly).catch((error) => {
          toast.error(getErrorMessage(error))
        })
      }}
    >
      <Printer className="size-4" />
      Печать
    </Button>
  )
}
