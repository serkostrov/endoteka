import {
  ClipboardCheck,
  ClipboardList,
  FileStack,
  FileText,
  LayoutDashboard,
  ListChecks,
  Package,
  PackagePlus,
  ScanLine,
  Settings,
  Shield,
  ShoppingCart,
  Users,
  UserSquare2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'

export type NavItem = {
  label: string
  to: string
  icon: LucideIcon
  permission: Permission
  description: string
  badgeCount?: number
}

export type NavGroup = {
  id: string
  label: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    id: 'main',
    label: 'Основное',
    items: [
      {
        label: 'Главная',
        to: routes.home,
        icon: LayoutDashboard,
        permission: Permission.DashboardRead,
        description: 'Рабочий стол сервисного центра',
      },
      {
        label: 'Заказы',
        to: routes.orders,
        icon: ClipboardList,
        permission: Permission.OrdersRead,
        description: 'Ремонтные заказы и статусы работ',
      },
      {
        label: 'Задачи',
        to: routes.tasks,
        icon: ListChecks,
        permission: Permission.TasksRead,
        description: 'Назначения и контроль работ',
      },
    ],
  },
  {
    id: 'warehouse',
    label: 'Хранилище',
    items: [
      {
        label: 'Склад',
        to: routes.inventory,
        icon: Package,
        permission: Permission.InventoryRead,
        description: 'Остатки и складские операции',
      },
      {
        label: 'Приходы',
        to: routes.inventoryReceipts,
        icon: PackagePlus,
        permission: Permission.InventoryReceive,
        description: 'Поступления на склад',
      },
      {
        label: 'Инвентаризация',
        to: routes.inventoryCounts,
        icon: ClipboardCheck,
        permission: Permission.InventoryCount,
        description: 'Пересчёты и сверка остатков',
      },
      {
        label: 'Продажи',
        to: routes.sales,
        icon: ShoppingCart,
        permission: Permission.SalesRead,
        description: 'Счета внешним клиентам',
      },
    ],
  },
  {
    id: 'catalogs',
    label: 'Справочники',
    items: [
      {
        label: 'Клиенты',
        to: routes.customers,
        icon: UserSquare2,
        permission: Permission.CustomersRead,
        description: 'Организации и контактные лица',
      },
      {
        label: 'Приборы',
        to: routes.devices,
        icon: Wrench,
        permission: Permission.DevicesRead,
        description: 'Эндоскопы и сервисная история',
      },
      {
        label: 'Номенклатура',
        to: routes.inventoryItems,
        icon: ScanLine,
        permission: Permission.InventoryRead,
        description: 'Позиции запчастей и расходников',
      },
    ],
  },
  {
    id: 'documents',
    label: 'Документы',
    items: [
      {
        label: 'Документы',
        to: routes.documents,
        icon: FileText,
        permission: Permission.DocumentsRead,
        description: 'Акты, накладные и этикетки',
      },
      {
        label: 'Шаблоны',
        to: routes.documentTemplates,
        icon: FileStack,
        permission: Permission.DocumentsEditTemplates,
        description: 'Печатные формы и этикетки',
      },
    ],
  },
  {
    id: 'admin',
    label: 'Администрирование',
    items: [
      {
        label: 'Пользователи',
        to: routes.users,
        icon: Users,
        permission: Permission.UsersRead,
        description: 'Учётные записи сотрудников',
      },
      {
        label: 'Роли и права',
        to: routes.roles,
        icon: Shield,
        permission: Permission.RolesRead,
        description: 'Роли и разрешения доступа',
      },
      {
        label: 'Настройки',
        to: routes.settings,
        icon: Settings,
        permission: Permission.SettingsRead,
        description: 'Параметры организации',
      },
      {
        label: 'Журнал действий',
        to: routes.auditLog,
        icon: ClipboardList,
        permission: Permission.AuditRead,
        description: 'Аудит операций в системе',
      },
    ],
  },
]

export function filterNavGroups(
  groups: NavGroup[],
  canAccess: (permission: Permission) => boolean,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccess(item.permission)),
    }))
    .filter((group) => group.items.length > 0)
}

export function flattenNavItems(groups: NavGroup[] = navGroups): NavItem[] {
  return groups.flatMap((group) => group.items)
}

export function matchNavItem(pathname: string, items: NavItem[] = flattenNavItems()): NavItem | undefined {
  const exact = items.find((item) => item.to === pathname)
  if (exact) {
    return exact
  }

  return items
    .filter((item) => item.to !== '/' && pathname.startsWith(`${item.to}/`))
    .sort((left, right) => right.to.length - left.to.length)[0]
}

export function isNavItemActive(pathname: string, item: NavItem, items: NavItem[]): boolean {
  return matchNavItem(pathname, items)?.to === item.to
}

export type BreadcrumbItem = {
  label: string
  to?: string
}

export function getBreadcrumbs(pathname: string, items: NavItem[] = flattenNavItems()): BreadcrumbItem[] {
  if (pathname === routes.home) {
    return [{ label: 'Главная' }]
  }

  const crumbs: BreadcrumbItem[] = [{ label: 'Главная', to: routes.home }]

  if (pathname === routes.settingsReferences) {
    return [...crumbs, { label: 'Настройки', to: routes.settings }, { label: 'Параметры' }]
  }

  if (pathname.startsWith(`${routes.settingsReferences}/`)) {
    return [
      ...crumbs,
      { label: 'Настройки', to: routes.settings },
      { label: 'Параметры', to: routes.settingsReferences },
      { label: 'Состав' },
    ]
  }

  if (pathname === routes.settingsFields) {
    return [...crumbs, { label: 'Настройки', to: routes.settings }, { label: 'Поля карточек' }]
  }

  if (pathname.startsWith(`${routes.settingsFields}/`)) {
    return [
      ...crumbs,
      { label: 'Настройки', to: routes.settings },
      { label: 'Поля карточек', to: routes.settingsFields },
      { label: 'Раздел' },
    ]
  }

  if (pathname === routes.settingsOrders) {
    return [...crumbs, { label: 'Настройки', to: routes.settings }, { label: 'Маршрут заказов' }]
  }

  if (pathname === routes.settingsOrderStatuses) {
    return [
      ...crumbs,
      { label: 'Настройки', to: routes.settings },
      { label: 'Параметры', to: routes.settingsReferences },
      { label: 'Статусы заказов' },
    ]
  }

  if (pathname === routes.settingsNotifications) {
    return [...crumbs, { label: 'Настройки', to: routes.settings }, { label: 'Уведомления' }]
  }

  if (pathname === routes.ordersNew) {
    return [...crumbs, { label: 'Заказы', to: routes.orders }, { label: 'Новый заказ' }]
  }

  if (pathname.endsWith('/print')) {
    const current = matchNavItem(pathname, items)
    if (current) {
      const parentPath = pathname.replace(/\/print$/, '')
      return [
        ...crumbs,
        { label: current.label, to: current.to },
        { label: 'Карточка', to: parentPath },
        { label: 'Печать' },
      ]
    }
  }
  const current = matchNavItem(pathname, items)

  if (!current) {
    return [...crumbs, { label: 'Страница' }]
  }

  if (current.to === pathname) {
    return [...crumbs, { label: current.label }]
  }

  return [...crumbs, { label: current.label, to: current.to }, { label: 'Карточка' }]
}

export function getBackPath(pathname: string, items: NavItem[] = flattenNavItems()): string | null {
  const crumbs = getBreadcrumbs(pathname, items)
  for (let index = crumbs.length - 2; index >= 0; index -= 1) {
    const to = crumbs[index]?.to
    if (to) {
      return to
    }
  }
  return null
}
