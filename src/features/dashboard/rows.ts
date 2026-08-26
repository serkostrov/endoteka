import { dashboardHrefs } from '@/lib/constants/dashboard'

import { DashboardFocus } from './layout'
import type { OperationalDashboard } from './services/dashboard-service'

export type DashboardCountRow = {
  id: string
  label: string
  count: number
  to: string
  tone?: 'danger' | 'warning'
}

type SectionRows = {
  attention: DashboardCountRow[]
  workflow: DashboardCountRow[]
  summary: DashboardCountRow[]
}

function takeUnused(rows: DashboardCountRow[], used: Set<string>) {
  const result: DashboardCountRow[] = []
  for (const row of rows) {
    if (used.has(row.id)) {
      continue
    }
    used.add(row.id)
    result.push(row)
  }
  return result
}

export function buildDashboardSections(focus: DashboardFocus, data: OperationalDashboard): SectionRows {
  const used = new Set<string>()
  const orders = data.orders
  const tasks = data.tasks
  const inventory = data.inventory

  const overdue: DashboardCountRow = {
    id: 'orders-overdue',
    label: 'Просроченные заказы',
    count: orders.overdue,
    to: dashboardHrefs.overdueOrders,
    tone: 'danger',
  }
  const approaching: DashboardCountRow = {
    id: 'orders-approaching',
    label: 'Ближний срок',
    count: orders.approaching,
    to: dashboardHrefs.approachingOrders,
    tone: 'warning',
  }
  const waiting: DashboardCountRow = {
    id: 'orders-waiting-approval',
    label: 'Ждут согласования',
    count: orders.waitingApproval,
    to: dashboardHrefs.waitingApproval,
    tone: 'warning',
  }
  const attentionOrders: DashboardCountRow = {
    id: 'orders-attention',
    label: 'Требуют внимания',
    count: orders.attention,
    to: dashboardHrefs.attentionOrders,
    tone: 'warning',
  }
  const repair: DashboardCountRow = {
    id: 'orders-repair',
    label: 'В ремонте',
    count: orders.repair,
    to: dashboardHrefs.inRepair,
  }
  const diagnostics: DashboardCountRow = {
    id: 'orders-diagnostics',
    label: 'На диагностике',
    count: orders.diagnostics,
    to: dashboardHrefs.diagnostics,
  }
  const active: DashboardCountRow = {
    id: 'orders-active',
    label: 'Активные заказы',
    count: orders.active,
    to: dashboardHrefs.activeOrders,
  }
  const mineOverdue: DashboardCountRow = {
    id: 'orders-mine-overdue',
    label: 'Ваши просроченные заказы',
    count: orders.mineOverdue,
    to: dashboardHrefs.myOverdueOrders,
    tone: 'danger',
  }
  const mineActive: DashboardCountRow = {
    id: 'orders-mine-active',
    label: 'Назначены вам',
    count: orders.mineActive,
    to: dashboardHrefs.myActiveOrders,
  }
  const mineDiagnostics: DashboardCountRow = {
    id: 'orders-mine-diagnostics',
    label: 'Ваша диагностика',
    count: orders.mineDiagnostics,
    to: dashboardHrefs.myDiagnostics,
  }
  const mineTasksOverdue: DashboardCountRow = {
    id: 'tasks-mine-overdue',
    label: 'Ваши просроченные задачи',
    count: tasks.mineOverdue,
    to: dashboardHrefs.myTasksOverdue,
    tone: 'danger',
  }
  const mineTasksToday: DashboardCountRow = {
    id: 'tasks-mine-today',
    label: 'Задачи на сегодня',
    count: tasks.mineToday,
    to: dashboardHrefs.myTasksToday,
    tone: 'warning',
  }
  const mineTasksOpen: DashboardCountRow = {
    id: 'tasks-mine-open',
    label: 'Ваши открытые задачи',
    count: tasks.mineOpen,
    to: dashboardHrefs.myOpenTasks,
  }
  const openTasks: DashboardCountRow = {
    id: 'tasks-open',
    label: 'Открытые задачи',
    count: tasks.open,
    to: dashboardHrefs.openTasks,
  }
  const zeroStock: DashboardCountRow = {
    id: 'stock-zero',
    label: 'Нет остатка',
    count: inventory.zeroStock,
    to: dashboardHrefs.zeroStock,
    tone: 'warning',
  }

  const attentionCandidates: DashboardCountRow[] = []
  const workflowCandidates: DashboardCountRow[] = []
  const summaryCandidates: DashboardCountRow[] = []

  if (data.canOrders) {
    if (focus === DashboardFocus.Engineer) {
      attentionCandidates.push(mineOverdue)
      workflowCandidates.push(mineActive)
      if (data.canDiagnostics) {
        workflowCandidates.push(mineDiagnostics)
      }
      summaryCandidates.push(mineActive)
    } else if (focus === DashboardFocus.Warehouse) {
      attentionCandidates.push(repair)
      workflowCandidates.push(repair, active)
      summaryCandidates.push(active, repair)
    } else {
      attentionCandidates.push(overdue, approaching, waiting, attentionOrders)
      workflowCandidates.push(active, repair)
      if (data.canDiagnostics) {
        workflowCandidates.push(diagnostics)
      }
      workflowCandidates.push(mineActive)
      if (data.canDiagnostics) {
        workflowCandidates.push(mineDiagnostics)
      }
      summaryCandidates.push(active, repair, waiting, diagnostics)
    }
  }

  if (data.canTasks) {
    attentionCandidates.push(mineTasksOverdue)
    workflowCandidates.push(mineTasksToday, mineTasksOpen)
    if (focus === DashboardFocus.Management || focus === DashboardFocus.Manager) {
      summaryCandidates.push(openTasks, mineTasksOpen)
    } else {
      summaryCandidates.push(mineTasksOpen)
    }
  }

  if (data.canInventory) {
    if (focus === DashboardFocus.Warehouse || focus === DashboardFocus.Management) {
      attentionCandidates.push(zeroStock)
      workflowCandidates.push(zeroStock)
    }
    summaryCandidates.push(zeroStock)
  }

  return {
    attention: takeUnused(
      attentionCandidates.filter((row) => row.count > 0),
      used,
    ),
    workflow: takeUnused(workflowCandidates, used),
    summary: takeUnused(summaryCandidates, used),
  }
}
