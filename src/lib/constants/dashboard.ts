import { OrderStatusCode } from '@/lib/constants/orders'
import { routes } from '@/lib/constants/routes'

export const dashboardHrefs = {
  overdueOrders: `${routes.orders}?deadline=overdue`,
  approachingOrders: `${routes.orders}?deadline=approaching`,
  waitingApproval: `${routes.orders}?status=${OrderStatusCode.WaitingApproval}`,
  inRepair: `${routes.orders}?status=${OrderStatusCode.Repair}`,
  diagnostics: `${routes.orders}?status=${OrderStatusCode.Diagnostics}`,
  activeOrders: `${routes.orders}?active=1`,
  attentionOrders: `${routes.orders}?attention=1`,
  myActiveOrders: `${routes.orders}?responsible=me&active=1`,
  myOverdueOrders: `${routes.orders}?responsible=me&deadline=overdue`,
  myDiagnostics: `${routes.orders}?responsible=me&status=${OrderStatusCode.Diagnostics}`,
  openTasks: `${routes.tasks}?status=open`,
  myOpenTasks: `${routes.tasks}?assignee=me&status=open`,
  myTasksToday: `${routes.tasks}?assignee=me&status=open&due=today`,
  myTasksOverdue: `${routes.tasks}?assignee=me&status=open&due=overdue`,
  zeroStock: `${routes.inventory}?stock=zero`,
} as const
