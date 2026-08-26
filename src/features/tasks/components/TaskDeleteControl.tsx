import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { useDeleteTask } from '../hooks/use-tasks'

type TaskDeleteTarget = {
  id: string
  title: string
  orderId: string | null
}

type TaskDeleteControlProps = {
  task: TaskDeleteTarget
  variant?: 'icon' | 'button'
  onDeleted?: () => void
}

export function TaskDeleteControl({ task, variant = 'icon', onDeleted }: TaskDeleteControlProps) {
  const canDelete = useHasPermission(Permission.TasksDelete)
  const remove = useDeleteTask()
  const [open, setOpen] = useState(false)

  if (!canDelete) {
    return null
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync({ id: task.id, orderId: task.orderId })
      toast.success('Задача удалена')
      setOpen(false)
      onDeleted?.()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <>
      {variant === 'button' ? (
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
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <IconActionButton
            label="Удалить"
            className="text-destructive hover:text-destructive"
            onClick={() => setOpen(true)}
          >
            <Trash2 />
          </IconActionButton>
        </div>
      )}
      <ConfirmDialog
        open={open}
        title="Удалить задачу"
        description={`«${task.title}» будет удалена без восстановления.`}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setOpen}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}
