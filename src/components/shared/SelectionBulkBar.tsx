import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { formatInteger } from '@/lib/utils/number'

type SelectionBulkBarProps = {
  count: number
  onClear: () => void
  children?: ReactNode
  pending?: boolean
}

/** Панель над таблицей при массовом выборе строк. */
export function SelectionBulkBar({ count, onClear, children, pending = false }: SelectionBulkBarProps) {
  if (count <= 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <p className="mr-1 text-sm font-medium">Выбрано: {formatInteger(count)}</p>
      {children}
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onClear}>
        Снять выбор
      </Button>
    </div>
  )
}
