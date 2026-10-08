import { useMemo, useState } from 'react'
import { CheckCheck, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { useCurrentUser, useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatInteger } from '@/lib/utils/number'

import { canMutateTaskAccess } from '../lib/task-access'
import { useDeleteTask, useSetTaskCompleted } from '../hooks/use-tasks'
import type { TaskListItem } from '../services/tasks-service'

type TaskBulkActionsProps = {
  selectedIds: string[]
  tasks: TaskListItem[]
  onClear: () => void
}

export function TaskBulkActions({ selectedIds, tasks, onClear }: TaskBulkActionsProps) {
  const count = selectedIds.length
  const user = useCurrentUser()
  const canUpdate = useHasPermission(Permission.TasksUpdate)
  const canManageOthers = useHasPermission(Permission.TasksManageOthers)
  const canDelete = useHasPermission(Permission.TasksDelete)
  const complete = useSetTaskCompleted()
  const remove = useDeleteTask()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const selectedTasks = useMemo(() => {
    const idSet = new Set(selectedIds)
    return tasks.filter((task) => idSet.has(task.id))
  }, [selectedIds, tasks])

  const mutableTasks = useMemo(
    () =>
      selectedTasks.filter((task) =>
        canMutateTaskAccess({
          assigneeId: task.assigneeId,
          currentUserId: user?.id,
          canUpdate,
          canManageOthers,
        }),
      ),
    [canManageOthers, canUpdate, selectedTasks, user?.id],
  )

  const incompleteCount = mutableTasks.filter((task) => !task.completed).length
  const completedCount = mutableTasks.filter((task) => task.completed).length
  const deletableCount = canDelete
    ? mutableTasks.length
    : 0

  if (count === 0) {
    return null
  }

  async function handleComplete() {
    const targets = mutableTasks.filter((task) => !task.completed)
    if (targets.length === 0) {
      return
    }
    setPending(true)
    try {
      for (const task of targets) {
        await complete.mutateAsync({ id: task.id, completed: true, orderId: task.orderId })
      }
      toast.success(
        targets.length === 1
          ? 'Задача выполнена'
          : `Выполнено задач: ${formatInteger(targets.length)}`,
      )
      onClear()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function handleReopen() {
    const targets = mutableTasks.filter((task) => task.completed)
    if (targets.length === 0) {
      return
    }
    setPending(true)
    try {
      for (const task of targets) {
        await complete.mutateAsync({ id: task.id, completed: false, orderId: task.orderId })
      }
      toast.success(
        targets.length === 1
          ? 'Задача возвращена в работу'
          : `Возвращено в работу: ${formatInteger(targets.length)}`,
      )
      onClear()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function handleDelete() {
    setPending(true)
    try {
      for (const task of mutableTasks) {
        await remove.mutateAsync({ id: task.id, orderId: task.orderId })
      }
      toast.success(
        mutableTasks.length === 1
          ? 'Задача удалена'
          : `Удалено задач: ${formatInteger(mutableTasks.length)}`,
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
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur-sm">
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

        {canDelete && deletableCount > 0 ? (
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
