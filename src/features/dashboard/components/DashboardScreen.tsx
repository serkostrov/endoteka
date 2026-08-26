import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/features/auth'
import { useMarkNotificationRead } from '@/features/notifications/hooks/use-notifications'
import { OrderDeadlineCell, OrderStatusBadge } from '@/features/orders/components/OrderBadges'
import { formatTaskDueDate, isTaskOverdue } from '@/features/tasks/services/tasks-service'
import { isDeadlineState } from '@/lib/constants/orders'
import { routes } from '@/lib/constants/routes'
import { isTaskPriority, taskPriorityLabels, taskPriorityTone } from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/utils/date'

import { useOperationalDashboard } from '../hooks/use-dashboard'
import { DashboardFocus, dashboardFocusDescriptions, getDashboardFocus } from '../layout'
import { buildDashboardSections, type DashboardCountRow } from '../rows'
import type {
  DashboardNotificationPreview,
  DashboardOrderPreview,
  DashboardStockPreview,
  DashboardTaskPreview,
} from '../services/dashboard-service'

function notificationPath(entityType: string | null, entityId: string | null) {
  if (entityType === 'order' && entityId) {
    return routes.order.replace(':id', entityId)
  }
  if (entityType === 'task' && entityId) {
    return routes.task.replace(':id', entityId)
  }
  return null
}

function CountRow({ row }: { row: DashboardCountRow }) {
  return (
    <li className="border-b last:border-b-0">
      <Link
        to={row.to}
        className="flex items-center gap-3 py-2 text-sm hover:text-primary"
        aria-label={`${row.label}: ${row.count}`}
      >
        <span className="min-w-0 flex-1">{row.label}</span>
        <span
          className={cn(
            'tabular-nums',
            row.count === 0 && 'text-muted-foreground',
            row.count > 0 && row.tone === 'danger' && 'font-medium text-destructive',
            row.count > 0 && row.tone === 'warning' && 'font-medium text-amber-700 dark:text-amber-400',
          )}
        >
          {row.count}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  )
}

function OrderPreviewRow({ order }: { order: DashboardOrderPreview }) {
  return (
    <li className="border-b last:border-b-0">
      <Link
        to={routes.order.replace(':id', order.id)}
        className="flex items-center gap-2 py-1.5 text-sm hover:text-primary"
      >
        <span className="font-medium">{order.number}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{order.customerName}</span>
        <OrderStatusBadge code={order.statusCode} name={order.statusName} />
        {isDeadlineState(order.deadlineState) ? (
          <OrderDeadlineCell order={{ deadline: order.deadline, deadlineState: order.deadlineState }} />
        ) : null}
      </Link>
    </li>
  )
}

function TaskPreviewRow({ task }: { task: DashboardTaskPreview }) {
  const overdue = isTaskOverdue(task.dueDate, false)
  const priority = isTaskPriority(task.priority) ? task.priority : null

  return (
    <li className="border-b last:border-b-0">
      <Link to={routes.task.replace(':id', task.id)} className="flex items-center gap-2 py-1.5 text-sm hover:text-primary">
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        {task.orderNumber ? <span className="text-muted-foreground">{task.orderNumber}</span> : null}
        {task.dueDate ? (
          <span className={cn(overdue && 'text-destructive')}>{formatTaskDueDate(task.dueDate)}</span>
        ) : null}
        {priority ? <StatusBadge tone={taskPriorityTone(priority)}>{taskPriorityLabels[priority]}</StatusBadge> : null}
      </Link>
    </li>
  )
}

function StockPreviewRow({ item }: { item: DashboardStockPreview }) {
  return (
    <li className="border-b last:border-b-0">
      <Link
        to={routes.inventoryItem.replace(':id', item.id)}
        className="flex items-center gap-2 py-1.5 text-sm hover:text-primary"
      >
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        <span className="text-muted-foreground">{item.code}</span>
        <StatusBadge tone="warning">Нет остатка</StatusBadge>
      </Link>
    </li>
  )
}

function NotificationPreviewRow({
  item,
  onRead,
}: {
  item: DashboardNotificationPreview
  onRead: (id: string) => void
}) {
  const to = notificationPath(item.entityType, item.entityId)
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{item.title}</span>
        {item.body ? <span className="block text-xs text-muted-foreground">{item.body}</span> : null}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
    </>
  )

  return (
    <li className="border-b last:border-b-0">
      {to ? (
        <Link
          to={to}
          className="flex items-start gap-2 py-1.5 text-sm hover:text-primary"
          onClick={() => onRead(item.id)}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          className="flex w-full items-start gap-2 py-1.5 text-left text-sm hover:text-primary"
          onClick={() => onRead(item.id)}
        >
          {content}
        </button>
      )}
    </li>
  )
}

function PreviewBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <ul>{children}</ul>
    </div>
  )
}

export function DashboardScreen() {
  const { user } = useAuth()
  const dashboardQuery = useOperationalDashboard()
  const markRead = useMarkNotificationRead()
  const focus = getDashboardFocus(user)
  const data = dashboardQuery.data
  const sections = data ? buildDashboardSections(focus, data) : null
  const greetingName = user?.fullName || user?.email || ''
  const hasOperationalAccess = Boolean(
    data?.canOrders || data?.canTasks || data?.canInventory || data?.canNotifications,
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Рабочий стол"
        description={
          greetingName
            ? `${greetingName}. ${dashboardFocusDescriptions[focus]}`
            : dashboardFocusDescriptions[focus]
        }
      />

      {dashboardQuery.isLoading ? <LoadingState label="Загрузка рабочего стола…" /> : null}
      {dashboardQuery.error ? (
        <ErrorState
          description={getErrorMessage(dashboardQuery.error)}
          onRetry={() => void dashboardQuery.refetch()}
        />
      ) : null}

      {data && !hasOperationalAccess ? (
        <EmptyState
          title="Нет операционных данных"
          description="Для вашей учётной записи пока нет доступа к заказам, задачам или складу."
        />
      ) : null}

      {data && sections && hasOperationalAccess ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <SectionCard title="Требует внимания">
              {sections.attention.length === 0 && data.notifications.unread === 0 ? (
                <p className="text-sm text-muted-foreground">Сейчас нет срочных заказов и задач.</p>
              ) : (
                <div className="space-y-3">
                  {sections.attention.length > 0 ? (
                    <ul>
                      {sections.attention.map((row) => (
                        <CountRow key={row.id} row={row} />
                      ))}
                    </ul>
                  ) : null}
                  {focus === DashboardFocus.Engineer && data.orders.mineItems.length > 0 ? (
                    <PreviewBlock title="Ваши заказы">
                      {data.orders.mineItems.map((order) => (
                        <OrderPreviewRow key={order.id} order={order} />
                      ))}
                    </PreviewBlock>
                  ) : null}
                  {focus !== DashboardFocus.Engineer &&
                  focus !== DashboardFocus.Warehouse &&
                  data.orders.overdueItems.length > 0 ? (
                    <PreviewBlock title="Просроченные">
                      {data.orders.overdueItems.map((order) => (
                        <OrderPreviewRow key={order.id} order={order} />
                      ))}
                    </PreviewBlock>
                  ) : null}
                  {focus === DashboardFocus.Warehouse && data.orders.repairItems.length > 0 ? (
                    <PreviewBlock title="В ремонте">
                      {data.orders.repairItems.map((order) => (
                        <OrderPreviewRow key={order.id} order={order} />
                      ))}
                    </PreviewBlock>
                  ) : null}
                  {data.canTasks &&
                  data.tasks.mineItems.length > 0 &&
                  (focus === DashboardFocus.Engineer || data.tasks.mineOverdue > 0) ? (
                    <PreviewBlock title="Ваши задачи">
                      {data.tasks.mineItems.map((task) => (
                        <TaskPreviewRow key={task.id} task={task} />
                      ))}
                    </PreviewBlock>
                  ) : null}
                  {data.canInventory &&
                  (focus === DashboardFocus.Warehouse || focus === DashboardFocus.Management) &&
                  data.inventory.items.length > 0 ? (
                    <PreviewBlock title="Нет остатка">
                      {data.inventory.items.map((item) => (
                        <StockPreviewRow key={item.id} item={item} />
                      ))}
                    </PreviewBlock>
                  ) : null}
                  {data.canNotifications && data.notifications.items.length > 0 ? (
                    <PreviewBlock title="Непрочитанные уведомления">
                      {data.notifications.items.map((item) => (
                        <NotificationPreviewRow
                          key={item.id}
                          item={item}
                          onRead={(id) => void markRead.mutate(id)}
                        />
                      ))}
                    </PreviewBlock>
                  ) : null}
                </div>
              )}
            </SectionCard>

            <SectionCard title="В работе">
              {sections.workflow.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет доступных очередей по вашим правам.</p>
              ) : (
                <ul>
                  {sections.workflow.map((row) => (
                    <CountRow key={row.id} row={row} />
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          <div className="space-y-4">
            <SectionCard title="Сводка">
              {sections.summary.length === 0 ? (
                <p className="text-sm text-muted-foreground">Показатели появятся, когда появятся данные.</p>
              ) : (
                <ul>
                  {sections.summary.map((row) => (
                    <CountRow key={row.id} row={row} />
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>
      ) : null}
    </div>
  )
}
