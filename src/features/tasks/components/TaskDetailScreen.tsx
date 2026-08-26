import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useState } from 'react'

import { DatePicker } from '@/components/shared/DatePicker'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useHasPermission } from '@/features/auth'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import {
  TASK_ASSIGNEE_NONE,
  TaskPriority,
  isTaskPriority,
  taskPriorityLabels,
  taskPriorityTone,
} from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { TaskCompleteControl } from './TaskCompleteControl'
import { TaskDeleteControl } from './TaskDeleteControl'
import { useTask, useUpdateTask } from '../hooks/use-tasks'
import { formatTaskDueDate, isTaskOverdue, type Task } from '../services/tasks-service'

export function TaskDetailScreen() {
  const { id } = useParams()
  const taskQuery = useTask(id)

  if (taskQuery.isLoading) {
    return <LoadingState label="Загрузка задачи" />
  }

  if (taskQuery.error) {
    return <ErrorState description={getErrorMessage(taskQuery.error)} />
  }

  const task = taskQuery.data
  if (!task) {
    return <ErrorState description="Задача не найдена." />
  }

  return <TaskBody task={task} />
}

function TaskBody({ task }: { task: Task }) {
  const navigate = useNavigate()
  const canUpdate = useHasPermission(Permission.TasksUpdate)
  const overdue = isTaskOverdue(task.dueDate, task.completed)

  return (
    <div className="space-y-4">
      <PageHeader
        title={task.title}
        description={task.completed ? 'Выполнена' : overdue ? 'Просрочена' : 'Открыта'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TaskCompleteControl task={task} variant="button" />
            <TaskDeleteControl task={task} variant="button" onDeleted={() => navigate(routes.tasks)} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge tone={task.completed ? 'success' : overdue ? 'danger' : 'neutral'}>
          {task.completed ? 'Выполнена' : 'Открыта'}
        </StatusBadge>
        <StatusBadge tone={taskPriorityTone(task.priority)}>{taskPriorityLabels[task.priority]}</StatusBadge>
        {task.orderId && task.orderNumber ? (
          <Link to={routes.order.replace(':id', task.orderId)} className="text-primary hover:underline">
            Заказ {task.orderNumber}
          </Link>
        ) : (
          <span className="text-muted-foreground">Без заказа</span>
        )}
        <span className="text-muted-foreground">
          {task.createdByName ? `Создал ${task.createdByName}` : 'Создана'}
          {` · ${formatDateTime(task.createdAt)}`}
        </span>
        {task.completedAt ? (
          <span className="text-muted-foreground">Выполнена {formatDateTime(task.completedAt)}</span>
        ) : null}
      </div>

      {canUpdate ? (
        <TaskEditForm key={`${task.id}-${task.completed}-${task.completedAt ?? ''}`} task={task} />
      ) : (
        <SectionCard title="Описание" description={task.assigneeName ? `Исполнитель: ${task.assigneeName}` : 'Без исполнителя'}>
          <p className={cn('whitespace-pre-wrap text-sm', !task.body && 'text-muted-foreground')}>
            {task.body || 'Без дополнительного текста.'}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Срок: {task.dueDate ? formatTaskDueDate(task.dueDate) : 'не указан'}
          </p>
        </SectionCard>
      )}
    </div>
  )
}

function TaskEditForm({ task }: { task: Task }) {
  const employees = useActiveEmployees()
  const update = useUpdateTask(task.id)
  const [title, setTitle] = useState(task.title)
  const [body, setBody] = useState(task.body)
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? TASK_ASSIGNEE_NONE)
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [priority, setPriority] = useState(task.priority)

  async function submit() {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error('Укажите задачу')
      return
    }
    try {
      await update.mutateAsync({
        title: trimmed,
        body: body.trim(),
        assigneeId: assigneeId === TASK_ASSIGNEE_NONE ? null : assigneeId,
        dueDate: dueDate || null,
        priority,
      })
      toast.success('Сохранено')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <SectionCard title="Карточка" description="Измените поля и нажмите «Сохранить».">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="task-edit-title">Задача</Label>
          <Input id="task-edit-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-edit-body">Описание</Label>
          <Textarea id="task-edit-body" value={body} onChange={(event) => setBody(event.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Исполнитель</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger className="w-full" aria-label="Исполнитель">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
              <SelectItem value={TASK_ASSIGNEE_NONE}>Не назначен</SelectItem>
              {task.assigneeId && !(employees.data ?? []).some((employee) => employee.id === task.assigneeId) ? (
                <SelectItem value={task.assigneeId}>{task.assigneeName || 'Исполнитель'}</SelectItem>
              ) : null}
              {(employees.data ?? []).map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.fullName}
                </SelectItem>
              ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Приоритет</Label>
            <Select value={priority} onValueChange={(value) => setPriority(isTaskPriority(value) ? value : task.priority)}>
              <SelectTrigger className="w-full" aria-label="Приоритет">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(TaskPriority).map((code) => (
                  <SelectItem key={code} value={code}>
                    {taskPriorityLabels[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-edit-due">Срок</Label>
            <DatePicker id="task-edit-due" value={dueDate} onChange={setDueDate} />
          </div>
        </div>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </form>
    </SectionCard>
  )
}
