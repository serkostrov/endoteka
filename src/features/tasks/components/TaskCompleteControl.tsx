import { Check } from 'lucide-react'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { useCurrentUser, useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { canMutateTaskAccess } from '../lib/task-access'
import { useSetTaskCompleted } from '../hooks/use-tasks'

type TaskCompleteTarget = {
  id: string
  completed: boolean
  orderId: string | null
  assigneeId: string | null
}

type TaskCompleteControlProps = {
  task: TaskCompleteTarget
  variant?: 'checkbox' | 'circle' | 'button'
  size?: 'sm' | 'default'
}

export function TaskCompleteControl({
  task,
  variant = 'checkbox',
  size = 'sm',
}: TaskCompleteControlProps) {
  const user = useCurrentUser()
  const canUpdate = useHasPermission(Permission.TasksUpdate)
  const canManageOthers = useHasPermission(Permission.TasksManageOthers)
  const canMutate = canMutateTaskAccess({
    assigneeId: task.assigneeId,
    currentUserId: user?.id,
    canUpdate,
    canManageOthers,
  })
  const complete = useSetTaskCompleted()
  const pending = complete.isPending

  async function toggle() {
    try {
      await complete.mutateAsync({
        id: task.id,
        completed: !task.completed,
        orderId: task.orderId,
      })
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  if (variant === 'button') {
    return (
      <Button type="button" size={size} disabled={!canMutate || pending} onClick={() => void toggle()}>
        {pending ? 'Сохранение…' : task.completed ? 'Вернуть в работу' : 'Выполнена'}
      </Button>
    )
  }

  if (variant === 'circle') {
    return (
      <div
        className="flex items-center justify-center"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          disabled={!canMutate || pending}
          aria-label={task.completed ? 'Вернуть в работу' : 'Отметить выполненной'}
          aria-pressed={task.completed}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            'disabled:cursor-not-allowed disabled:opacity-50',
            task.completed
              ? 'border-success bg-success text-success-foreground'
              : 'border-muted-foreground/40 text-transparent hover:border-success hover:text-success/40',
          )}
          onClick={() => void toggle()}
        >
          <Check className="size-3 stroke-[2.5]" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex items-center justify-center"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Checkbox
        checked={task.completed}
        disabled={!canMutate || pending}
        onCheckedChange={() => void toggle()}
        aria-label={task.completed ? 'Вернуть в работу' : 'Отметить выполненной'}
      />
    </div>
  )
}
