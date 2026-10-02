import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ChevronRight,
  ClipboardList,
  ListChecks,
  Package,
  UserSquare2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { useOpenEntitySheet, type EntitySheetKind } from '@/app/sheet-stack'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/features/auth'
import { useMarkNotificationRead } from '@/features/notifications/hooks/use-notifications'
import { OrderDeadlineCell, OrderStatusBadge } from '@/features/orders/components/OrderBadges'
import { formatTaskDueDate, isTaskOverdue } from '@/features/tasks/services/tasks-service'
import { dashboardHrefs } from '@/lib/constants/dashboard'
import { isDeadlineState } from '@/lib/constants/orders'
import { routes } from '@/lib/constants/routes'
import { isTaskPriority, taskPriorityLabels, taskPriorityTone } from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/utils/date'
import { formatInteger } from '@/lib/utils/number'

import { useOperationalDashboard } from '../hooks/use-dashboard'
import { DashboardFocus, dashboardFocusDescriptions, getDashboardFocus } from '../layout'
import { buildDashboardSections, type DashboardCountRow } from '../rows'
import type {
  DashboardNotificationPreview,
  DashboardOrderPreview,
  DashboardStockPreview,
  DashboardTaskPreview,
  OperationalDashboard,
} from '../services/dashboard-service'

function notificationEntity(
  entityType: string | null,
  entityId: string | null,
): { kind: EntitySheetKind; id: string } | null {
  if (entityType === 'order' && entityId) {
    return { kind: 'order', id: entityId }
  }
  if (entityType === 'task' && entityId) {
    return { kind: 'task', id: entityId }
  }
  return null
}

function metricIcon(row: DashboardCountRow): LucideIcon {
  if (row.id.startsWith('stock')) {
    return Package
  }
  if (row.id.startsWith('tasks')) {
    return ListChecks
  }
  if (row.tone === 'danger' || row.tone === 'warning') {
    return AlertTriangle
  }
  return ClipboardList
}

function MetricChip({ row }: { row: DashboardCountRow }) {
  const Icon = metricIcon(row)
  const hot = row.count > 0 && (row.tone === 'danger' || row.tone === 'warning')

  return (
    <Link
      to={row.to}
      className={cn(
        'group flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3.5 py-3 transition-colors',
        'hover:border-primary/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        hot && row.tone === 'danger' && 'border-destructive/25 bg-destructive/5',
        hot && row.tone === 'warning' && 'border-amber-500/25 bg-amber-500/5',
      )}
      aria-label={`${row.label}: ${row.count}`}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
          hot && row.tone === 'danger' && 'bg-destructive/10 text-destructive',
          hot && row.tone === 'warning' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-xl font-semibold tabular-nums tracking-tight',
            row.count === 0 && 'text-muted-foreground',
            hot && row.tone === 'danger' && 'text-destructive',
            hot && row.tone === 'warning' && 'text-amber-700 dark:text-amber-400',
          )}
        >
          {formatInteger(row.count)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{row.label}</span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden="true"
      />
    </Link>
  )
}

function QueueRow({ row }: { row: DashboardCountRow }) {
  const max = Math.max(row.count, 1)
  const fill = row.count === 0 ? 0 : Math.min(100, Math.round((row.count / Math.max(max, 8)) * 100) + 12)

  return (
    <li>
      <Link
        to={row.to}
        className="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/60"
        aria-label={`${row.label}: ${row.count}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{row.label}</span>
            <span
              className={cn(
                'tabular-nums text-sm',
                row.count === 0 && 'text-muted-foreground',
                row.count > 0 && row.tone === 'danger' && 'font-medium text-destructive',
                row.count > 0 &&
                  row.tone === 'warning' &&
                  'font-medium text-amber-700 dark:text-amber-400',
              )}
            >
              {formatInteger(row.count)}
            </span>
          </span>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                'block h-full rounded-full transition-all',
                row.count === 0 && 'bg-transparent',
                row.count > 0 && !row.tone && 'bg-primary/60',
                row.count > 0 && row.tone === 'danger' && 'bg-destructive/70',
                row.count > 0 && row.tone === 'warning' && 'bg-amber-500/70',
              )}
              style={{ width: `${fill}%` }}
            />
          </span>
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}

function OrderPreviewRow({ order }: { order: DashboardOrderPreview }) {
  const openSheet = useOpenEntitySheet()

  return (
    <li>
      <button
        type="button"
        className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
        onClick={() => openSheet('order', order.id)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-primary group-hover:underline">
            {order.number}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {[order.customerName || null, order.responsibleName || null].filter(Boolean).join(' · ') ||
              'Без клиента'}
          </span>
        </span>
        <OrderStatusBadge code={order.statusCode} name={order.statusName} />
        {isDeadlineState(order.deadlineState) ? (
          <OrderDeadlineCell order={{ deadline: order.deadline, deadlineState: order.deadlineState }} />
        ) : null}
      </button>
    </li>
  )
}

function TaskPreviewRow({ task }: { task: DashboardTaskPreview }) {
  const openSheet = useOpenEntitySheet()
  const overdue = isTaskOverdue(task.dueDate, false)
  const priority = isTaskPriority(task.priority) ? task.priority : null

  return (
    <li>
      <button
        type="button"
        className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
        onClick={() => openSheet('task', task.id)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:text-primary">{task.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {[task.orderNumber, task.dueDate ? formatTaskDueDate(task.dueDate) : null]
              .filter(Boolean)
              .join(' · ') || 'Без срока'}
          </span>
        </span>
        {overdue ? <StatusBadge tone="danger">Просрочена</StatusBadge> : null}
        {priority && !overdue ? (
          <StatusBadge tone={taskPriorityTone(priority)}>{taskPriorityLabels[priority]}</StatusBadge>
        ) : null}
      </button>
    </li>
  )
}

function StockPreviewRow({ item }: { item: DashboardStockPreview }) {
  const openSheet = useOpenEntitySheet()

  return (
    <li>
      <button
        type="button"
        className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
        onClick={() => openSheet('item', item.id)}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Package className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:text-primary">{item.name}</span>
          {item.code ? (
            <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
              {item.code}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">0</span>
      </button>
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
  const openSheet = useOpenEntitySheet()
  const entity = notificationEntity(item.entityType, item.entityId)

  return (
    <li>
      <button
        type="button"
        className="group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
        onClick={() => {
          onRead(item.id)
          if (entity) {
            openSheet(entity.kind, entity.id)
          }
        }}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:text-primary">{item.title}</span>
          {item.body ? (
            <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(item.createdAt)}</span>
      </button>
    </li>
  )
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card',
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/40 px-3.5 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{children}</div>
    </section>
  )
}

function PanelEmpty({ title, description, to, actionLabel }: {
  title: string
  description: string
  to: string
  actionLabel: string
}) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      <Link to={to} className="mt-1 text-xs font-medium text-primary hover:underline">
        {actionLabel}
      </Link>
    </div>
  )
}

function QuickLink({
  to,
  label,
  description,
  icon: Icon,
}: {
  to: string
  label: string
  description: string
  icon: LucideIcon
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 transition-colors hover:border-primary/30 hover:bg-muted/40"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  )
}

function pickOrderPreviews(focus: DashboardFocus, data: OperationalDashboard): {
  title: string
  href: string
  items: DashboardOrderPreview[]
} {
  if (focus === DashboardFocus.Engineer && data.orders.mineItems.length > 0) {
    return { title: 'Ваши заказы', href: dashboardHrefs.myActiveOrders, items: data.orders.mineItems }
  }
  if (focus === DashboardFocus.Warehouse && data.orders.repairItems.length > 0) {
    return { title: 'В ремонте', href: dashboardHrefs.inRepair, items: data.orders.repairItems }
  }
  if (data.orders.overdueItems.length > 0) {
    return { title: 'Просроченные', href: dashboardHrefs.overdueOrders, items: data.orders.overdueItems }
  }
  if (data.orders.mineItems.length > 0) {
    return { title: 'Ваши заказы', href: dashboardHrefs.myActiveOrders, items: data.orders.mineItems }
  }
  if (data.orders.repairItems.length > 0) {
    return { title: 'В ремонте', href: dashboardHrefs.inRepair, items: data.orders.repairItems }
  }
  return { title: 'Заказы', href: dashboardHrefs.activeOrders, items: [] }
}

/** Собирает до 8 плиток без дыр в сетке 4×2. */
function buildMetricTiles(
  _focus: DashboardFocus,
  data: OperationalDashboard,
  sections: ReturnType<typeof buildDashboardSections>,
): DashboardCountRow[] {
  const preferred = [...sections.attention, ...sections.summary, ...sections.workflow]
  const extras: DashboardCountRow[] = []

  if (data.canOrders) {
    extras.push(
      {
        id: 'orders-overdue',
        label: 'Просроченные заказы',
        count: data.orders.overdue,
        to: dashboardHrefs.overdueOrders,
        tone: 'danger',
      },
      {
        id: 'orders-approaching',
        label: 'Ближний срок',
        count: data.orders.approaching,
        to: dashboardHrefs.approachingOrders,
        tone: 'warning',
      },
      {
        id: 'orders-waiting-approval',
        label: 'Ждут согласования',
        count: data.orders.waitingApproval,
        to: dashboardHrefs.waitingApproval,
        tone: 'warning',
      },
      {
        id: 'orders-active',
        label: 'Активные заказы',
        count: data.orders.active,
        to: dashboardHrefs.activeOrders,
      },
      {
        id: 'orders-repair',
        label: 'В ремонте',
        count: data.orders.repair,
        to: dashboardHrefs.inRepair,
      },
      {
        id: 'orders-diagnostics',
        label: 'На диагностике',
        count: data.orders.diagnostics,
        to: dashboardHrefs.diagnostics,
      },
      {
        id: 'orders-mine-active',
        label: 'Назначены вам',
        count: data.orders.mineActive,
        to: dashboardHrefs.myActiveOrders,
      },
      {
        id: 'orders-mine-diagnostics',
        label: 'Ваша диагностика',
        count: data.orders.mineDiagnostics,
        to: dashboardHrefs.myDiagnostics,
      },
    )
  }

  if (data.canTasks) {
    extras.push(
      {
        id: 'tasks-open',
        label: 'Открытые задачи',
        count: data.tasks.open,
        to: dashboardHrefs.openTasks,
      },
      {
        id: 'tasks-mine-open',
        label: 'Ваши открытые задачи',
        count: data.tasks.mineOpen,
        to: dashboardHrefs.myOpenTasks,
      },
      {
        id: 'tasks-mine-today',
        label: 'Задачи на сегодня',
        count: data.tasks.mineToday,
        to: dashboardHrefs.myTasksToday,
        tone: 'warning',
      },
      {
        id: 'tasks-mine-overdue',
        label: 'Ваши просроченные задачи',
        count: data.tasks.mineOverdue,
        to: dashboardHrefs.myTasksOverdue,
        tone: 'danger',
      },
    )
  }

  if (data.canInventory) {
    extras.push({
      id: 'stock-zero',
      label: 'Нет остатка',
      count: data.inventory.zeroStock,
      to: dashboardHrefs.zeroStock,
      tone: 'warning',
    })
  }

  if (data.canNotifications) {
    extras.push({
      id: 'notifications-unread',
      label: 'Непрочитанные',
      count: data.notifications.unread,
      to: routes.home,
      tone: data.notifications.unread > 0 ? 'warning' : undefined,
    })
  }

  const merged = [...preferred, ...extras].filter(
    (row, index, list) => list.findIndex((item) => item.id === row.id) === index,
  )

  return merged
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

  const metricRows =
    sections == null || !data
      ? []
      : buildMetricTiles(focus, data, sections)

  const metricTiles = metricRows.slice(0, metricRows.length > 4 ? 8 : 4)

  const orderFeed = data ? pickOrderPreviews(focus, data) : null

  return (
    <div className="flex min-h-[calc(100dvh-1.5rem)] flex-col gap-3 md:min-h-[calc(100dvh-2rem)]">
      <PageHeader
        className="shrink-0"
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
        <>
          <div className="grid shrink-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {metricTiles.map((row) => (
              <MetricChip key={row.id} row={row} />
            ))}
          </div>

          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {data.canOrders ? (
              <Panel
                title={orderFeed?.title ?? 'Заказы'}
                action={
                  <Link
                    to={orderFeed?.href ?? dashboardHrefs.activeOrders}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Открыть
                  </Link>
                }
                className="min-h-[18rem]"
              >
                {orderFeed && orderFeed.items.length > 0 ? (
                  <ul className="space-y-0.5">
                    {orderFeed.items.map((order) => (
                      <OrderPreviewRow key={order.id} order={order} />
                    ))}
                  </ul>
                ) : (
                  <PanelEmpty
                    title="Заказов в фокусе нет"
                    description="Просроченных и назначенных вам сейчас нет — можно открыть общий список."
                    to={dashboardHrefs.activeOrders}
                    actionLabel="К заказам"
                  />
                )}
              </Panel>
            ) : null}

            {data.canInventory ? (
              <Panel
                title="Нет остатка"
                action={
                  <Link
                    to={dashboardHrefs.zeroStock}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Склад
                  </Link>
                }
                className="min-h-[18rem]"
              >
                {data.inventory.items.length > 0 ? (
                  <ul className="space-y-0.5">
                    {data.inventory.items.map((item) => (
                      <StockPreviewRow key={item.id} item={item} />
                    ))}
                  </ul>
                ) : (
                  <PanelEmpty
                    title="Всё в наличии"
                    description="Позиций с нулевым остатком сейчас нет."
                    to={routes.inventory}
                    actionLabel="К складу"
                  />
                )}
              </Panel>
            ) : null}

            {data.canTasks ? (
              <Panel
                title="Задачи"
                action={
                  <Link
                    to={dashboardHrefs.myOpenTasks}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Все
                  </Link>
                }
                className="min-h-[18rem]"
              >
                {data.tasks.mineItems.length > 0 ? (
                  <ul className="space-y-0.5">
                    {data.tasks.mineItems.map((task) => (
                      <TaskPreviewRow key={task.id} task={task} />
                    ))}
                  </ul>
                ) : (
                  <PanelEmpty
                    title="Задач нет"
                    description="Назначенных вам открытых задач сейчас нет."
                    to={routes.tasks}
                    actionLabel="К задачам"
                  />
                )}
              </Panel>
            ) : null}

            <Panel title="Очереди" className="min-h-[18rem]">
              {sections.workflow.length > 0 ? (
                <ul className="space-y-0.5">
                  {sections.workflow.map((row) => (
                    <QueueRow key={row.id} row={row} />
                  ))}
                </ul>
              ) : (
                <PanelEmpty
                  title="Очереди пусты"
                  description="Нет доступных очередей по вашим правам."
                  to={routes.home}
                  actionLabel="Обновить"
                />
              )}
            </Panel>

            {data.canNotifications ? (
              <Panel
                title="Уведомления"
                action={
                  data.notifications.unread > 0 ? (
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {formatInteger(data.notifications.unread)}
                    </span>
                  ) : null
                }
                className="min-h-[18rem]"
              >
                {data.notifications.items.length > 0 ? (
                  <ul className="space-y-0.5">
                    {data.notifications.items.map((item) => (
                      <NotificationPreviewRow
                        key={item.id}
                        item={item}
                        onRead={(id) => void markRead.mutate(id)}
                      />
                    ))}
                  </ul>
                ) : (
                  <PanelEmpty
                    title="Всё прочитано"
                    description="Новых уведомлений нет."
                    to={routes.home}
                    actionLabel="Рабочий стол"
                  />
                )}
              </Panel>
            ) : null}

            <Panel title="Быстрый переход" className="min-h-[18rem]">
              <div className="grid gap-2 p-1.5 sm:grid-cols-1">
                {data.canOrders ? (
                  <QuickLink
                    to={routes.orders}
                    label="Заказы"
                    description="Список и доска ремонта"
                    icon={ClipboardList}
                  />
                ) : null}
                {data.canTasks ? (
                  <QuickLink
                    to={routes.tasks}
                    label="Задачи"
                    description="Назначения и сроки"
                    icon={ListChecks}
                  />
                ) : null}
                {data.canInventory ? (
                  <QuickLink
                    to={routes.inventory}
                    label="Склад"
                    description="Остатки и документы"
                    icon={Package}
                  />
                ) : null}
                <QuickLink
                  to={routes.devices}
                  label="Приборы"
                  description="Реестр и виды"
                  icon={Wrench}
                />
                <QuickLink
                  to={routes.customers}
                  label="Контакты"
                  description="Клиенты и организации"
                  icon={UserSquare2}
                />
              </div>
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  )
}
