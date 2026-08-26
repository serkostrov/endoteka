import { Calendar, Link2, Pencil, User } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { IconActionButton } from '@/components/shared/IconActionButton'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { taskPriorityLabels, taskPriorityTone } from '@/lib/constants/tasks'
import { routes } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'

import { TaskCompleteControl } from './TaskCompleteControl'
import { TaskDeleteControl } from './TaskDeleteControl'
import { taskDueHint, type TaskListItem } from '../services/tasks-service'

type TaskListCardProps = {
  task: TaskListItem
}

export function TaskListCard({ task }: TaskListCardProps) {
  const navigate = useNavigate()
  const canUpdate = useHasPermission(Permission.TasksUpdate)
  const due = taskDueHint(task.dueDate, task.completed)
  const to = routes.task.replace(':id', task.id)

  return (
    <article
      className={cn(
        'flex cursor-pointer gap-3 rounded-lg border bg-card px-3 py-3 shadow-xs transition-colors hover:bg-accent/40',
        task.completed && 'opacity-80',
      )}
      onClick={() => navigate(to)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(to)
        }
      }}
      role="link"
      tabIndex={0}
    >
      <TaskCompleteControl task={task} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className={cn('text-sm font-semibold', task.completed && 'text-muted-foreground line-through')}>
            {task.title}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {due ? (
              <span
                className={cn(
                  'mr-1 inline-flex items-center gap-1 text-xs font-medium',
                  due.tone === 'danger' && 'text-destructive',
                  due.tone === 'warning' && 'text-warning',
                  due.tone === 'muted' && 'text-muted-foreground',
                )}
              >
                <Calendar className="size-3.5" aria-hidden="true" />
                {due.label}
              </span>
            ) : null}
            {canUpdate ? (
              <div
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <IconActionButton label="Изменить" onClick={() => navigate(to)}>
                  <Pencil />
                </IconActionButton>
              </div>
            ) : null}
            <TaskDeleteControl task={task} />
          </div>
        </div>
        {task.body ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.body}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.orderId && task.orderNumber ? (
            <Link
              to={routes.order.replace(':id', task.orderId)}
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              <Link2 className="size-3.5" aria-hidden="true" />
              {task.orderNumber}
              {task.customerName ? ` · ${task.customerName}` : ''}
            </Link>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <User className="size-3.5" aria-hidden="true" />
            {task.createdByName || '—'}
            <span aria-hidden="true">→</span>
            {task.assigneeName || 'не назначен'}
          </span>
          <StatusBadge tone={taskPriorityTone(task.priority)}>{taskPriorityLabels[task.priority]}</StatusBadge>
        </div>
      </div>
    </article>
  )
}
