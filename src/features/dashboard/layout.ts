import { hasPermission, hasRole } from '@/features/auth/permissions'
import { Permission, Role } from '@/lib/constants/permissions'
import type { AuthUser } from '@/types/auth'

export const DashboardFocus = {
  Management: 'management',
  Manager: 'manager',
  Engineer: 'engineer',
  Warehouse: 'warehouse',
} as const

export type DashboardFocus = (typeof DashboardFocus)[keyof typeof DashboardFocus]

export const dashboardFocusDescriptions: Record<DashboardFocus, string> = {
  management: 'Сводка по заказам, задачам, складу и тому, что требует реакции.',
  manager: 'Заказы и задачи, которые нужно взять в работу или проконтролировать.',
  engineer: 'Ваши заказы, диагностика и назначенные задачи.',
  warehouse: 'Ремонт, остатки и позиции, которые нужно пополнить.',
}

export function getDashboardFocus(user: AuthUser | null): DashboardFocus {
  if (!user) {
    return DashboardFocus.Manager
  }

  if (hasRole(user, Role.Director)) {
    return DashboardFocus.Management
  }

  const isLead = hasRole(user, Role.Manager) || hasRole(user, Role.ChiefEngineer)
  const isEngineer = hasRole(user, Role.DiagnosticEngineer)
  const isWarehouse = hasRole(user, Role.Storekeeper)

  if (isWarehouse && !isLead && !isEngineer) {
    return DashboardFocus.Warehouse
  }

  if (isEngineer && !isLead) {
    return DashboardFocus.Engineer
  }

  if (isLead) {
    return DashboardFocus.Manager
  }

  if (isWarehouse) {
    return DashboardFocus.Warehouse
  }

  if (hasPermission(user, Permission.InventoryRead) && !hasPermission(user, Permission.OrdersCreate)) {
    return DashboardFocus.Warehouse
  }

  if (hasPermission(user, Permission.DiagnosticsRead) && !hasPermission(user, Permission.OrdersAssign)) {
    return DashboardFocus.Engineer
  }

  return DashboardFocus.Manager
}
