import { Permission } from '@/lib/constants/permissions'

export const matrixColumns = [
  { id: 'read', label: 'Чтение' },
  { id: 'create', label: 'Создание' },
  { id: 'edit', label: 'Изменение' },
  { id: 'delete', label: 'Удаление' },
] as const

export type MatrixColumnId = (typeof matrixColumns)[number]['id']

export type PermissionModule = {
  resource: string
  label: string
  cells: Partial<Record<MatrixColumnId, Permission>>
  extras: { code: Permission; label: string }[]
}

export const permissionModules: PermissionModule[] = [
  {
    resource: 'orders',
    label: 'Заказы',
    cells: {
      read: Permission.OrdersRead,
      create: Permission.OrdersCreate,
      edit: Permission.OrdersUpdate,
      delete: Permission.OrdersDelete,
    },
    extras: [
      { code: Permission.OrdersChangeStatus, label: 'Смена статуса' },
      { code: Permission.OrdersAssign, label: 'Назначение' },
    ],
  },
  {
    resource: 'customers',
    label: 'Клиенты',
    cells: {
      read: Permission.CustomersRead,
      create: Permission.CustomersCreate,
      edit: Permission.CustomersUpdate,
      delete: Permission.CustomersDelete,
    },
    extras: [],
  },
  {
    resource: 'devices',
    label: 'Приборы',
    cells: {
      read: Permission.DevicesRead,
      create: Permission.DevicesCreate,
      edit: Permission.DevicesUpdate,
      delete: Permission.DevicesDelete,
    },
    extras: [],
  },
  {
    resource: 'tasks',
    label: 'Задачи',
    cells: {
      read: Permission.TasksRead,
      create: Permission.TasksCreate,
      edit: Permission.TasksUpdate,
      delete: Permission.TasksDelete,
    },
    extras: [],
  },
  {
    resource: 'diagnostics',
    label: 'Диагностика',
    cells: {
      read: Permission.DiagnosticsRead,
      edit: Permission.DiagnosticsUpdate,
    },
    extras: [],
  },
  {
    resource: 'inventory',
    label: 'Склад',
    cells: {
      read: Permission.InventoryRead,
    },
    extras: [
      { code: Permission.InventoryReceive, label: 'Приход' },
      { code: Permission.InventoryWriteOff, label: 'Списание' },
      { code: Permission.InventoryCount, label: 'Инвентаризация' },
    ],
  },
  {
    resource: 'sales',
    label: 'Продажи',
    cells: {
      read: Permission.SalesRead,
      create: Permission.SalesCreate,
      edit: Permission.SalesUpdate,
      delete: Permission.SalesDelete,
    },
    extras: [],
  },
  {
    resource: 'documents',
    label: 'Документы',
    cells: {
      read: Permission.DocumentsRead,
      create: Permission.DocumentsCreate,
    },
    extras: [
      { code: Permission.DocumentsPrint, label: 'Печать' },
      { code: Permission.DocumentsEditTemplates, label: 'Шаблоны' },
    ],
  },
  {
    resource: 'users',
    label: 'Пользователи',
    cells: {
      read: Permission.UsersRead,
      edit: Permission.UsersUpdate,
    },
    extras: [{ code: Permission.UsersInvite, label: 'Приглашение' }],
  },
  {
    resource: 'roles',
    label: 'Роли',
    cells: {
      read: Permission.RolesRead,
      edit: Permission.RolesUpdate,
    },
    extras: [],
  },
  {
    resource: 'settings',
    label: 'Настройки',
    cells: {
      read: Permission.SettingsRead,
      edit: Permission.SettingsUpdate,
    },
    extras: [],
  },
  {
    resource: 'audit',
    label: 'Журнал',
    cells: {
      read: Permission.AuditRead,
    },
    extras: [],
  },
  {
    resource: 'dashboard',
    label: 'Рабочий стол',
    cells: {
      read: Permission.DashboardRead,
    },
    extras: [],
  },
  {
    resource: 'notifications',
    label: 'Уведомления',
    cells: {
      read: Permission.NotificationsRead,
    },
    extras: [],
  },
]

export function allCatalogPermissions(): Permission[] {
  return permissionModules.flatMap((module) => [
    ...Object.values(module.cells),
    ...module.extras.map((item) => item.code),
  ])
}
