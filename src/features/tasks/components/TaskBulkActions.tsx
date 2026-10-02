import { useMemo, useState } from 'react'
import { CheckCheck, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatInteger } from '@/lib/utils/number'

import { useDeleteTask, useSetTaskCompleted } from '../hooks/use-tasks'
import type { TaskListItem } from '../services/tasks-service'

type TaskBulkActionsProps = {
  selectedIds: string[]
  tasks: TaskListItem[]
  onClear: () => void
}

export function TaskBulkActions({ selectedIds, tasks, onClear }: TaskBulkActionsProps) {
  const count = selectedIds.length
  const canUpdate = useHasPermission(Permission.TasksUpdate)
  const canDelete = useHasPermission(Permission.TasksDelete)
  const complete = useSetTaskCompleted()
  const remove = useDeleteTask()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const selectedTasks = useMemo(() => {
    const idSet = new Set(selectedIds)
    return tasks.filter((task) => idSet.has(task.id))
  }, [selectedIds, tasks])

  const incompleteCount = selectedTasks.filter((task) => !task.completed).length
  const completedCount = selectedTasks.filter((task) => task.completed).length

  if (count === 0) {
    return null
  }

  async function runBulk(
    action: (task: TaskListItem) => Promise<unknown>,
    successMessage: string,
  ) {
    setPending(true)
    try {
      for (const task of selectedTasks) {
        await action(task)
      }
      toast.success(successMessage)
      onClear()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function handleComplete() {
    const targets = selectedTasks.filter((task) => !task.completed)
    if (targets.length === 0) {
      return
    }
    await runBulk(
      (task) => complete.mutateAsync({ id: task.id, completed: true, orderId: task.orderId }),
      targets.length === 1
        ? 'Задача выполнена'
        : `Выполнено задач: ${formatInteger(targets.length)}`,
    )
  }

  async function handleReopen() {
    const targets = selectedTasks.filter((task) => task.completed)
    if (targets.length === 0) {
      return
    }
    await runBulk(
      (task) => complete.mutateAsync({ id: task.id, completed: false, orderId: task.orderId }),
      targets.length === 1
        ? 'Задача возвращена в работу'
        : `Возвращено в работу: ${formatInteger(targets.length)}`,
    )
  }

  async function handleDelete() {
    setPending(true)
    try {
      for (const task of selectedTasks) {
        await remove.mutateAsync({ id: task.id, orderId: task.orderId })
      }
      toast.success(
        count === 1 ? 'Задача удалена' : `Удалено задач: ${formatInteger(count)}`,
      )
      setDeleteOpen(false)
      onClear()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <p className="mr-1 text-sm font-medium">Выбрано: {formatInteger(count)}</p>

        {canUpdate && incompleteCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void handleComplete()}
          >
            <CheckCheck className="size-4" />
            Выполнить
            {incompleteCount < count ? ` · ${formatInteger(incompleteCount)}` : null}
          </Button>
        ) : null}

        {canUpdate && completedCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void handleReopen()}
          >
            <RotateCcw className="size-4" />
            В работу
            {completedCount < count ? ` · ${formatInteger(completedCount)}` : null}
          </Button>
        ) : null}

        {canDelete ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            aria-label="Удалить"
            disabled={pending}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}

        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onClear}>
          Снять выбор
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Удалить задачи"
        description={
          count === 1
            ? 'Выбранная задача будет удалена без восстановления.'
            : `Будет удалено задач: ${formatInteger(count)}. Действие необратимо.`
        }
        confirmLabel="Удалить"
        confirmVariant="destructive"
        isPending={pending || remove.isPending}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}
