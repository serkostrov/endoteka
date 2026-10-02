import { Calendar, Link2, Pencil, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Checkbox } from '@/components/ui/checkbox'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { taskPriorityLabels, taskPriorityTone } from '@/lib/constants/tasks'
import { sheets } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'

import { TaskCompleteControl } from './TaskCompleteControl'
import { TaskDeleteControl } from './TaskDeleteControl'
import { taskDueHint, type TaskListItem } from '../services/tasks-service'

type TaskListCardProps = {
  task: TaskListItem
  onOpen?: (taskId: string) => void
  selected?: boolean
  onSelectedChange?: (selected: boolean) => void
}

export function TaskListCard({ task, onOpen, selected, onSelectedChange }: TaskListCardProps) {
  const navigate = useNavigate()
  const canUpdate = useHasPermission(Permission.TasksUpdate)
  const due = taskDueHint(task.dueDate, task.completed)
  const to = sheets.task(task.id)
  const selectable = Boolean(onSelectedChange)

  function open() {
    if (onOpen) {
      onOpen(task.id)
      return
    }
    navigate(to)
  }

  return (
    <article
      className={cn(
        'group flex cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2 shadow-xs transition-colors',
        'hover:bg-accent/40',
        selected && 'border-primary/40 bg-primary/5 hover:bg-primary/8',
        task.completed && 'opacity-75',
      )}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      role="link"
      tabIndex={0}
    >
      {selectable ? (
        <div
          className="flex shrink-0 items-center"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelectedChange?.(value === true)}
            aria-label={selected ? 'Снять выбор' : 'Выбрать задачу'}
          />
        </div>
      ) : null}

      <TaskCompleteControl task={task} variant="circle" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p
            className={cn(
              'truncate text-sm font-medium',
              task.completed && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </p>
          <StatusBadge tone={taskPriorityTone(task.priority)} className="shrink-0 text-[11px]">
            {taskPriorityLabels[task.priority]}
          </StatusBadge>
          {due ? (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 text-xs font-medium',
                due.tone === 'danger' && 'text-destructive',
                due.tone === 'warning' && 'text-warning',
                due.tone === 'muted' && 'text-muted-foreground',
              )}
            >
              <Calendar className="size-3.5" aria-hidden="true" />
              {due.label}
            </span>
          ) : null}
        </div>

        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          {task.orderId && task.orderNumber ? (
            <EntitySheetLink
              kind="order"
              id={task.orderId}
              className="inline-flex max-w-full items-center gap-1 truncate text-primary hover:underline"
            >
              <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {task.orderNumber}
                {task.customerName ? ` · ${task.customerName}` : ''}
              </span>
            </EntitySheetLink>
          ) : null}
          <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <User className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {task.createdByName || '—'}
              <span aria-hidden="true"> → </span>
              {task.assigneeName || 'не назначен'}
            </span>
          </span>
          {task.body ? <span className="truncate text-muted-foreground/80">{task.body}</span> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        {canUpdate ? (
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <IconActionButton label="Изменить" onClick={open}>
              <Pencil />
            </IconActionButton>
          </div>
        ) : null}
        <TaskDeleteControl task={task} />
      </div>
    </article>
  )
}
