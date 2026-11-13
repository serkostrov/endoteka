import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type ConfirmDialogExtraAction = {
  label: string
  onClick: () => void
  variant?: 'default' | 'success' | 'outline'
  isPending?: boolean
}

type ConfirmDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'default' | 'destructive'
  extraAction?: ConfirmDialogExtraAction
  isPending?: boolean
  className?: string
  overlayClassName?: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  children?: ReactNode
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  confirmVariant = 'destructive',
  extraAction,
  isPending = false,
  className,
  overlayClassName,
  onOpenChange,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const busy = isPending || Boolean(extraAction?.isPending)

  return (
    <div
      className="contents"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={className} overlayClassName={overlayClassName}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter
            className={cn(
              extraAction
                ? 'flex flex-col gap-2 sm:flex-col sm:items-stretch'
                : 'sm:flex-row sm:justify-end',
            )}
          >
            {extraAction ? (
              <Button
                type="button"
                className="w-full"
                variant={extraAction.variant ?? 'success'}
                onClick={extraAction.onClick}
                disabled={busy}
              >
                {extraAction.isPending ? 'Сохранение…' : extraAction.label}
              </Button>
            ) : null}
            <div
              className={cn(
                'flex w-full gap-2',
                extraAction ? 'flex-col sm:flex-row' : 'flex-col-reverse sm:flex-row sm:justify-end',
              )}
            >
              <Button
                type="button"
                className={cn(extraAction && 'w-full sm:flex-1')}
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                {cancelLabel}
              </Button>
              <Button
                type="button"
                className={cn(extraAction && 'w-full sm:flex-1')}
                variant={confirmVariant}
                onClick={onConfirm}
                disabled={busy}
              >
                {isPending ? 'Выполнение…' : confirmLabel}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
