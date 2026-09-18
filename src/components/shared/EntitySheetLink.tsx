import type { ReactNode } from 'react'

import { useOpenEntitySheet, type EntitySheetKind } from '@/app/sheet-stack'
import { cn } from '@/lib/utils'

type EntitySheetLinkProps = {
  kind: EntitySheetKind
  id: string
  children: ReactNode
  className?: string
  stopPropagation?: boolean
}

/** Открывает карточку поверх текущего окна, без перехода на другой раздел. */
export function EntitySheetLink({
  kind,
  id,
  children,
  className,
  stopPropagation = true,
}: EntitySheetLinkProps) {
  const openSheet = useOpenEntitySheet()

  return (
    <button
      type="button"
      className={cn(
        'cursor-pointer text-left text-primary underline-offset-2 hover:underline',
        className,
      )}
      onClick={(event) => {
        if (stopPropagation) {
          event.stopPropagation()
        }
        openSheet(kind, id)
      }}
    >
      {children}
    </button>
  )
}
