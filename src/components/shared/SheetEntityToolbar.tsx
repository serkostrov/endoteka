import type { ReactNode } from 'react'
import { Pencil, Trash2 } from 'lucide-react'

import { IconActionButton } from '@/components/shared/IconActionButton'

type SheetEntityToolbarProps = {
  onDelete?: () => void
  onEdit?: () => void
  deleteLabel?: string
  editLabel?: string
  deleteDisabled?: boolean
  editDisabled?: boolean
  /** Перед удалением (например, печать). */
  leading?: ReactNode
  extra?: ReactNode
}

/** Порядок под крестиком: leading → удалить → редактировать → extra. */
export function SheetEntityToolbar({
  onDelete,
  onEdit,
  deleteLabel = 'Удалить',
  editLabel = 'Редактировать',
  deleteDisabled = false,
  editDisabled = false,
  leading,
  extra,
}: SheetEntityToolbarProps) {
  if (!onDelete && !onEdit && !leading && !extra) {
    return null
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      {leading}
      {onDelete ? (
        <IconActionButton
          label={deleteLabel}
          variant="ghost"
          size="icon-sm"
          disabled={deleteDisabled}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 />
        </IconActionButton>
      ) : null}
      {onEdit ? (
        <IconActionButton
          label={editLabel}
          variant="ghost"
          size="icon-sm"
          disabled={editDisabled}
          onClick={onEdit}
        >
          <Pencil />
        </IconActionButton>
      ) : null}
      {extra}
    </div>
  )
}
