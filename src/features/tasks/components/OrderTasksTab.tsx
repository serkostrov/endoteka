import { useState } from 'react'

import { EmptyState } from '@/components/shared/EmptyState'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { CreateTaskDialog } from './CreateTaskDialog'
import { TaskListCard } from './TaskListCard'
import { useTasks } from '../hooks/use-tasks'

type OrderTasksTabProps = {
  orderId: string
  orderNumber: string
}

export function OrderTasksTab({ orderId, orderNumber }: OrderTasksTabProps) {
  const canCreate = useHasPermission(Permission.TasksCreate)
  const canRead = useHasPermission(Permission.TasksRead)
  const [createOpen, setCreateOpen] = useState(false)
  const tasksQuery = useTasks(
    {
      search: '',
      assigneeId: 'all',
      status: 'all',
      priority: 'all',
      due: 'all',
      linked: 'all',
      orderId,
      page: 1,
      pageSize: 50,
    },
    canRead,
  )

  if (!canRead && !canCreate) {
    return (
      <SectionCard title="Задачи">
        <p className="text-sm text-muted-foreground">Недостаточно прав для задач заказа.</p>
      </SectionCard>
    )
  }

  const items = tasksQuery.data?.items ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Назначения по этому заказу.</p>
        {canCreate ? (
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            Задача
          </Button>
        ) : null}
      </div>
      {tasksQuery.error ? (
        <p className="text-sm text-destructive">{getErrorMessage(tasksQuery.error)}</p>
      ) : items.length === 0 ? (
        <EmptyState title="Задач нет" description="Создайте задачу — она останется связанной с заказом." />
      ) : (
        <div className="space-y-2">
          {items.map((task) => (
            <TaskListCard key={task.id} task={task} />
          ))}
        </div>
      )}
      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        presetOrderId={orderId}
        presetOrderNumber={orderNumber}
      />
    </div>
  )
}
