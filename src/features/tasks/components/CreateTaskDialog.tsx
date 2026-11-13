import { useState } from 'react'
import { toast } from 'sonner'

import { DatePicker } from '@/components/shared/DatePicker'
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
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentUser, useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import {
  TASK_ASSIGNEE_NONE,
  TaskPriority,
  isTaskPriority,
  taskPriorityLabels,
} from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'
import { localDateTimeToIso } from '@/lib/utils/date'

import { TaskAssigneeSelect } from './TaskAssigneeSelect'
import { TaskOrderPicker } from './TaskOrderPicker'
import { useCreateTask } from '../hooks/use-tasks'
import type { TaskContext } from '../services/tasks-service'

type CreateTaskDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  presetOrderId?: string
  presetOrderNumber?: string
  presetContext?: TaskContext
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  presetOrderId,
  presetOrderNumber,
  presetContext = 'order',
}: CreateTaskDialogProps) {
  const linkedLabel =
    presetContext === 'assembly' && presetOrderNumber
      ? `К сборке заказа ${presetOrderNumber}.`
      : presetOrderNumber
        ? `К заказу ${presetOrderNumber}.`
        : 'Назначение, срок и связь с заказом.'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Новая задача</SheetTitle>
          <SheetDescription>{linkedLabel}</SheetDescription>
        </SheetHeader>
        {open ? (
          <CreateTaskForm
            presetOrderId={presetOrderId}
            presetOrderNumber={presetOrderNumber}
            presetContext={presetContext}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function CreateTaskForm({
  presetOrderId,
  presetOrderNumber,
  presetContext,
  onOpenChange,
}: {
  presetOrderId?: string
  presetOrderNumber?: string
  presetContext: TaskContext
  onOpenChange: (open: boolean) => void
}) {
  const user = useCurrentUser()
  const canPickOrder = useHasPermission(Permission.OrdersRead) && !presetOrderId
  const create = useCreateTask()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [assigneeId, setAssigneeId] = useState(user?.id ?? TASK_ASSIGNEE_NONE)
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<string>(TaskPriority.Normal)
  const [order, setOrder] = useState({
    orderId: presetOrderId ?? null,
    orderNumber: presetOrderNumber ?? '',
  })
  const dirty =
    title.trim() !== '' ||
    body.trim() !== '' ||
    dueDate !== '' ||
    assigneeId !== (user?.id ?? TASK_ASSIGNEE_NONE) ||
    priority !== TaskPriority.Normal ||
    (!presetOrderId && order.orderId !== null)
  useSheetDirty(dirty, persist)

  async function persist() {
    const trimmed = title.trim()
    if (!trimmed) {
      throw new Error('Укажите задачу')
    }
    await create.mutateAsync({
      title: trimmed,
      body: body.trim(),
      assigneeId: assigneeId === TASK_ASSIGNEE_NONE ? null : assigneeId,
      dueDate: localDateTimeToIso(dueDate),
      priority: isTaskPriority(priority) ? priority : TaskPriority.Normal,
      orderId: presetOrderId ?? order.orderId,
      context: presetContext,
    })
    toast.success('Задача создана')
  }

  async function submit() {
    try {
      await persist()
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <form
      className="flex flex-1 flex-col gap-4 px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="task-title">Задача</Label>
        <Input
          id="task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Что нужно сделать"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="task-body">Описание</Label>
        <Textarea
          id="task-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Необязательно"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TaskAssigneeSelect value={assigneeId} onValueChange={setAssigneeId} />
        <div className="space-y-2">
          <Label>Приоритет</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-full" aria-label="Приоритет">
              <SelectValue />
            </SelectTrigger>
            <SelectContent searchable>
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
        <Label htmlFor="task-due">Срок</Label>
        <DatePicker id="task-due" withTime value={dueDate} onChange={setDueDate} />
      </div>
      {presetOrderId ? (
        <p className="text-sm text-muted-foreground">
          {presetContext === 'assembly' ? 'Сборка заказа' : 'Заказ'}{' '}
          {presetOrderNumber || presetOrderId}
        </p>
      ) : canPickOrder ? (
        <div className="space-y-2">
          <Label>Заказ</Label>
          <TaskOrderPicker orderId={order.orderId} orderNumber={order.orderNumber} onChange={setOrder} />
        </div>
      ) : null}
      <SheetFooter className="px-0">
        <SheetClose asChild>
          <Button type="button" variant="outline">
            Отмена
          </Button>
        </SheetClose>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Создание…' : 'Создать'}
        </Button>
      </SheetFooter>
    </form>
  )
}
