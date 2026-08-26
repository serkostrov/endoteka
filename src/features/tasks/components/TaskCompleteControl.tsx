import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { useSetTaskCompleted } from '../hooks/use-tasks'

type TaskCompleteTarget = {
  id: string
  completed: boolean
  orderId: string | null
}

type TaskCompleteControlProps = {
  task: TaskCompleteTarget
  variant?: 'checkbox' | 'button'
}

export function TaskCompleteControl({ task, variant = 'checkbox' }: TaskCompleteControlProps) {
  const canUpdate = useHasPermission(Permission.TasksUpdate)
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
      <Button type="button" size="sm" disabled={!canUpdate || pending} onClick={() => void toggle()}>
        {pending ? 'Сохранение…' : task.completed ? 'Вернуть в работу' : 'Выполнена'}
      </Button>
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
        disabled={!canUpdate || pending}
        onCheckedChange={() => void toggle()}
        aria-label={task.completed ? 'Вернуть в работу' : 'Отметить выполненной'}
      />
    </div>
  )
}
