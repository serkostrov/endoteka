import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutDashboard,
  ListChecks,
  Package,
  PackageMinus,
  PackagePlus,
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
        description: 'Ремонтные заказы и этапы работ',
      },
      {
        label: 'Задачи',
        to: routes.tasks,
        icon: ListChecks,
        permission: Permission.TasksRead,
        description: 'Назначения сотрудникам и сроки',
      },
    ],
  },
  {
    id: 'warehouse',
    label: 'Учёт',
    items: [
      {
        label: 'Склад',
        to: routes.inventory,
        icon: Package,
        permission: Permission.InventoryRead,
        description: 'Текущие остатки на складе',
      },
      {
        label: 'Приходы',
        to: routes.inventoryReceipts,
        icon: PackagePlus,
        permission: Permission.InventoryReceive,
        description: 'Поступления товара на склад',
      },
      {
        label: 'Списания',
        to: routes.inventoryWriteOffs,
        icon: PackageMinus,
        permission: Permission.InventoryWriteOff,
        description: 'Списание товара со склада',
      },
      {
        label: 'Инвентаризация',
        to: routes.inventoryCounts,
        icon: ClipboardCheck,
        permission: Permission.InventoryCount,
        description: 'Пересчёт и сверка остатков',
      },
      {
        label: 'Продажи',
        to: routes.sales,
        icon: ShoppingCart,
        permission: Permission.SalesRead,
        description: 'Счета и продажи клиентам',
      },
    ],
  },
  {
    id: 'catalogs',
    label: 'Справочники',
    items: [
      {
        label: 'Приборы',
        to: routes.devices,
        icon: Wrench,
        permission: Permission.DevicesRead,
        description: 'Реестр приборов и виды',
      },
      {
        label: 'Номенклатура',
        to: routes.inventoryItems,
        icon: Boxes,
        permission: Permission.InventoryRead,
        description: 'Каталог запчастей и расходников',
      },
      {
        label: 'Контакты',
        to: routes.customers,
        icon: UserSquare2,
        permission: Permission.CustomersRead,
        description: 'Клиенты и организации',
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
        description: 'Матрица прав доступа',
      },
      {
        label: 'Настройки',
        to: routes.settings,
        icon: Settings,
        permission: Permission.SettingsRead,
        description: 'Параметры и шаблоны системы',
      },
      {
        label: 'Журнал действий',
        to: routes.auditLog,
        icon: History,
        permission: Permission.AuditRead,
        description: 'История операций в системе',
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

  if (pathname === routes.settingsServiceTemplates) {
    return [
      ...crumbs,
      { label: 'Настройки', to: routes.settings },
      { label: 'Параметры', to: routes.settingsReferences },
      { label: 'Шаблоны услуг' },
    ]
  }

  if (pathname === routes.documentTemplates) {
    return [...crumbs, { label: 'Настройки', to: routes.settings }, { label: 'Шаблоны документов' }]
  }

  if (pathname.startsWith(`${routes.documentTemplates}/`)) {
    const rest = pathname.slice(`${routes.documentTemplates}/`.length)
    const [id, print] = rest.split('/')
    const templateCrumbs: BreadcrumbItem[] = [
      ...crumbs,
      { label: 'Настройки', to: routes.settings },
      { label: 'Шаблоны документов', to: routes.documentTemplates },
    ]
    if (print === 'print' && id) {
      return [
        ...templateCrumbs,
        { label: 'Макет', to: routes.documentTemplate.replace(':id', id) },
        { label: 'Печать' },
      ]
    }
    return [...templateCrumbs, { label: 'Макет' }]
  }

  if (pathname === routes.documents) {
    return [...crumbs, { label: 'Документы' }]
  }

  if (/^\/documents\/[^/]+\/print$/.test(pathname)) {
    const id = pathname.split('/')[2]
    if (id) {
      return [...crumbs, { label: 'Документ', to: routes.document.replace(':id', id) }, { label: 'Печать' }]
    }
  }

  if (/^\/documents\/[^/]+$/.test(pathname)) {
    return [...crumbs, { label: 'Документ' }]
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
  // Пункты сайдбара — корневые экраны, кнопка «Назад» там не нужна.
  if (items.some((item) => item.to === pathname)) {
    return null
  }

  const crumbs = getBreadcrumbs(pathname, items)
  for (let index = crumbs.length - 2; index >= 0; index -= 1) {
    const to = crumbs[index]?.to
    if (to) {
      return to
    }
  }
  return null
}
