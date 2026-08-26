import { useState } from 'react'
import { toast } from 'sonner'

import { DatePicker } from '@/components/shared/DatePicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentUser, useHasPermission } from '@/features/auth'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { Permission } from '@/lib/constants/permissions'
import {
  TASK_ASSIGNEE_NONE,
  TaskPriority,
  isTaskPriority,
  taskPriorityLabels,
} from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'

import { TaskOrderPicker } from './TaskOrderPicker'
import { useCreateTask } from '../hooks/use-tasks'

type CreateTaskDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  presetOrderId?: string
  presetOrderNumber?: string
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  presetOrderId,
  presetOrderNumber,
}: CreateTaskDialogProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Новая задача</SheetTitle>
          <SheetDescription>
            {presetOrderNumber ? `К заказу ${presetOrderNumber}.` : 'Назначение, срок и связь с заказом.'}
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <CreateTaskForm
            presetOrderId={presetOrderId}
            presetOrderNumber={presetOrderNumber}
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
  onOpenChange,
}: {
  presetOrderId?: string
  presetOrderNumber?: string
  onOpenChange: (open: boolean) => void
}) {
  const user = useCurrentUser()
  const canPickOrder = useHasPermission(Permission.OrdersRead) && !presetOrderId
  const employees = useActiveEmployees()
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

  async function submit() {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error('Укажите задачу')
      return
    }
    try {
      await create.mutateAsync({
        title: trimmed,
        body: body.trim(),
        assigneeId: assigneeId === TASK_ASSIGNEE_NONE ? null : assigneeId,
        dueDate: dueDate || null,
        priority: isTaskPriority(priority) ? priority : TaskPriority.Normal,
        orderId: presetOrderId ?? order.orderId,
      })
      toast.success('Задача создана')
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
        <div className="space-y-2">
          <Label>Исполнитель</Label>
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger className="w-full" aria-label="Исполнитель">
              <SelectValue placeholder="Исполнитель" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TASK_ASSIGNEE_NONE}>Не назначен</SelectItem>
              {user && !(employees.data ?? []).some((employee) => employee.id === user.id) ? (
                <SelectItem value={user.id}>{user.fullName || user.email}</SelectItem>
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
          <Select value={priority} onValueChange={setPriority}>
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
        <Label htmlFor="task-due">Срок</Label>
        <DatePicker id="task-due" value={dueDate} onChange={setDueDate} />
      </div>
      {presetOrderId ? (
        <p className="text-sm text-muted-foreground">Заказ {presetOrderNumber || presetOrderId}</p>
      ) : canPickOrder ? (
        <div className="space-y-2">
          <Label>Заказ</Label>
          <TaskOrderPicker orderId={order.orderId} orderNumber={order.orderNumber} onChange={setOrder} />
        </div>
      ) : null}
      <SheetFooter className="px-0">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Отмена
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Создание…' : 'Создать'}
        </Button>
      </SheetFooter>
    </form>
  )
}
