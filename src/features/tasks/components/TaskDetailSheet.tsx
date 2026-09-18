import { toast } from 'sonner'
import { useState } from 'react'

import { DatePicker } from '@/components/shared/DatePicker'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  useSheetDirty,
  useSheetExitPresence,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useHasPermission } from '@/features/auth'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { Permission } from '@/lib/constants/permissions'
import {
  TASK_ASSIGNEE_NONE,
  TaskPriority,
  isTaskPriority,
  taskPriorityLabels,
  taskPriorityTone,
} from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime, localDateTimeToIso } from '@/lib/utils/date'

import { TaskCompleteControl } from './TaskCompleteControl'
import { TaskDeleteControl } from './TaskDeleteControl'
import { useTask, useUpdateTask } from '../hooks/use-tasks'
import { formatTaskDueDate, isTaskOverdue, type Task } from '../services/tasks-service'

type TaskDetailSheetProps = {
  taskId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskDetailSheet({ taskId, open, onOpenChange }: TaskDetailSheetProps) {
  const presence = useSheetExitPresence(open, taskId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? (
        <TaskDetailSheetContent key={presence.id} taskId={presence.id} onClose={() => onOpenChange(false)} />
      ) : null}
    </Sheet>
  )
}

function TaskDetailSheetContent({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const taskQuery = useTask(taskId)
  const task = taskQuery.data

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,40rem)]"
      actions={task ? <TaskDeleteControl task={task} onDeleted={onClose} /> : null}
    >
      {taskQuery.isLoading ? (
        <>
          <SheetHeader className="border-b pr-14">
            <SheetTitle>Задача</SheetTitle>
            <SheetDescription>Загрузка карточки.</SheetDescription>
          </SheetHeader>
          <LoadingState label="Загрузка задачи" className="min-h-40" />
        </>
      ) : taskQuery.error ? (
        <>
          <SheetHeader className="border-b pr-14">
            <SheetTitle>Задача</SheetTitle>
            <SheetDescription>Не удалось открыть карточку.</SheetDescription>
          </SheetHeader>
          <div className="px-4 py-4">
            <ErrorState description={getErrorMessage(taskQuery.error)} />
          </div>
        </>
      ) : !task ? (
        <>
          <SheetHeader className="border-b pr-14">
            <SheetTitle>Задача</SheetTitle>
            <SheetDescription>Запись не найдена.</SheetDescription>
          </SheetHeader>
          <div className="px-4 py-4">
            <ErrorState description="Задача не найдена." />
          </div>
        </>
      ) : (
        <TaskSheetCard key={`${task.id}-${task.completed}-${task.completedAt ?? ''}`} task={task} />
      )}
    </SheetContent>
  )
}

function TaskSheetCard({ task }: { task: Task }) {
  const canUpdate = useHasPermission(Permission.TasksUpdate)
  const overdue = isTaskOverdue(task.dueDate, task.completed)
  const statusLabel = task.completed ? 'Выполнена' : overdue ? 'Просрочена' : 'Открыта'

  return (
    <>
      <SheetHeader className="space-y-3 border-b pr-14">
        <div className="min-w-0">
          <SheetTitle className="text-lg leading-snug">{task.title}</SheetTitle>
          <SheetDescription className="mt-1">
            {task.assigneeName ? `Исполнитель ${task.assigneeName}` : 'Без исполнителя'}
            {task.dueDate ? ` · срок ${formatTaskDueDate(task.dueDate)}` : ''}
          </SheetDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={task.completed ? 'success' : overdue ? 'danger' : 'neutral'}>{statusLabel}</StatusBadge>
          <StatusBadge tone={taskPriorityTone(task.priority)}>{taskPriorityLabels[task.priority]}</StatusBadge>
          {task.orderNumber ? (
            <span className="text-xs text-muted-foreground">Заказ {task.orderNumber}</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {task.createdByName ? `Создал ${task.createdByName}` : 'Создана'}
            {` · ${formatDateTime(task.createdAt)}`}
          </span>
        </div>
      </SheetHeader>
      {canUpdate ? (
        <TaskSheetForm task={task} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-3 overflow-y-auto px-4 py-4">
            <p className={`whitespace-pre-wrap text-sm ${task.body ? '' : 'text-muted-foreground'}`}>
              {task.body || 'Без описания.'}
            </p>
          </div>
          <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-between gap-2 border-t">
            <TaskCompleteControl task={task} variant="button" size="default" />
            <SheetClose asChild>
              <Button type="button" variant="outline">
                Закрыть
              </Button>
            </SheetClose>
          </SheetFooter>
        </div>
      )}
    </>
  )
}

function TaskSheetForm({ task }: { task: Task }) {
  const employees = useActiveEmployees()
  const update = useUpdateTask(task.id, task.orderId)
  const [title, setTitle] = useState(task.title)
  const [body, setBody] = useState(task.body)
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? TASK_ASSIGNEE_NONE)
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [priority, setPriority] = useState(task.priority)
  const dirty =
    title !== task.title ||
    body !== task.body ||
    assigneeId !== (task.assigneeId ?? TASK_ASSIGNEE_NONE) ||
    dueDate !== (task.dueDate ?? '') ||
    priority !== task.priority
  useSheetDirty(dirty, persist)

  async function persist() {
    const trimmed = title.trim()
    if (!trimmed) {
      throw new Error('Укажите задачу')
    }
    await update.mutateAsync({
      title: trimmed,
      body: body.trim(),
      assigneeId: assigneeId === TASK_ASSIGNEE_NONE ? null : assigneeId,
      dueDate: localDateTimeToIso(dueDate),
      priority,
    })
    toast.success('Сохранено')
  }

  async function submit() {
    try {
      await persist()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="task-sheet-title">Задача</Label>
          <Input id="task-sheet-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-sheet-body">Описание</Label>
          <Textarea
            id="task-sheet-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Необязательно"
            rows={4}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-sheet-due">Срок</Label>
          <DatePicker id="task-sheet-due" withTime value={dueDate} onChange={setDueDate} />
        </div>
      </div>
      <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-between gap-2 border-t">
        <TaskCompleteControl task={task} variant="button" size="default" />
        <div className="flex items-center gap-2">
          <SheetClose asChild>
            <Button type="button" variant="outline">
              Закрыть
            </Button>
          </SheetClose>
          <Button type="submit" disabled={update.isPending || !dirty}>
            {update.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      </SheetFooter>
    </form>
  )
}
