export const Permission = {
  DashboardRead: 'dashboard:read',
  NotificationsRead: 'notifications:read',
  OrdersRead: 'orders:read',
  OrdersCreate: 'orders:create',
  OrdersUpdate: 'orders:update',
  OrdersDelete: 'orders:delete',
  OrdersChangeStatus: 'orders:change_status',
  OrdersAssign: 'orders:assign',
  CustomersRead: 'customers:read',
  CustomersCreate: 'customers:create',
  CustomersUpdate: 'customers:update',
  CustomersDelete: 'customers:delete',
  DevicesRead: 'devices:read',
  DevicesCreate: 'devices:create',
  DevicesUpdate: 'devices:update',
  DevicesDelete: 'devices:delete',
  TasksRead: 'tasks:read',
  TasksCreate: 'tasks:create',
  TasksUpdate: 'tasks:update',
  TasksDelete: 'tasks:delete',
  DiagnosticsRead: 'diagnostics:read',
  DiagnosticsUpdate: 'diagnostics:update',
  InventoryRead: 'inventory:read',
  InventoryReceive: 'inventory:receive',
  InventoryWriteOff: 'inventory:write_off',
  InventoryCount: 'inventory:inventory_count',
  SalesRead: 'sales:read',
  SalesCreate: 'sales:create',
  SalesUpdate: 'sales:update',
  SalesDelete: 'sales:delete',
  DocumentsRead: 'documents:read',
  DocumentsCreate: 'documents:create',
  DocumentsPrint: 'documents:print',
  DocumentsEditTemplates: 'documents:edit_templates',
  UsersRead: 'users:read',
  UsersInvite: 'users:invite',
  UsersUpdate: 'users:update',
  RolesRead: 'roles:read',
  RolesUpdate: 'roles:update',
  SettingsRead: 'settings:read',
  SettingsUpdate: 'settings:update',
  AuditRead: 'audit:read',
} as const

export type Permission = (typeof Permission)[keyof typeof Permission]

export const Role = {
  Manager: 'manager',
  DiagnosticEngineer: 'diagnostic_engineer',
  ChiefEngineer: 'chief_engineer',
  Storekeeper: 'storekeeper',
  Director: 'director',
} as const

export type Role = (typeof Role)[keyof typeof Role]

export const ProtectedRole = {
  Director: Role.Director,
  ChiefEngineer: Role.ChiefEngineer,
} as const
