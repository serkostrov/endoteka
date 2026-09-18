export const routes = {
  login: '/login',
  home: '/',
  orders: '/orders',
  ordersNew: '/orders/new',
  order: '/orders/:id',
  tasks: '/tasks',
  task: '/tasks/:id',
  customers: '/customers',
  customer: '/customers/:id',
  devices: '/devices',
  device: '/devices/:id',
  inventory: '/inventory',
  inventoryItems: '/inventory/items',
  inventoryItem: '/inventory/items/:id',
  inventoryReceipts: '/inventory/receipts',
  inventoryCounts: '/inventory/counts',
  inventoryCount: '/inventory/counts/:id',
  sales: '/sales',
  sale: '/sales/:id',
  documents: '/documents',
  document: '/documents/:id',
  documentPrint: '/documents/:id/print',
  documentTemplates: '/settings/document-templates',
  documentTemplate: '/settings/document-templates/:id',
  documentTemplatePrint: '/settings/document-templates/:id/print',
  users: '/users',
  roles: '/roles',
  role: '/roles/:id',
  settings: '/settings',
  settingsReferences: '/settings/references',
  settingsReference: '/settings/references/:setId',
  settingsFields: '/settings/fields',
  settingsFieldEntity: '/settings/fields/:entity',
  settingsOrders: '/settings/orders',
  settingsOrderStatuses: '/settings/order-statuses',
  settingsNotifications: '/settings/notifications',
  settingsServiceTemplates: '/settings/service-templates',
  auditLog: '/audit-log',
  authCallback: '/auth/callback',
  setPassword: '/set-password',
} as const

/** Карточки открываются sheet’ом на списке, не отдельной страницей. */
export const sheets = {
  order: (id: string) => `${routes.orders}?order=${encodeURIComponent(id)}`,
  task: (id: string) => `${routes.tasks}?task=${encodeURIComponent(id)}`,
  customer: (id: string, opts?: { edit?: boolean }) => sheetPath(routes.customers, 'customer', id, opts),
  device: (id: string, opts?: { edit?: boolean }) => sheetPath(routes.devices, 'device', id, opts),
  item: (id: string, opts?: { edit?: boolean }) => sheetPath(routes.inventoryItems, 'item', id, opts),
  count: (id: string) => `${routes.inventoryCounts}?count=${encodeURIComponent(id)}`,
  sale: (id: string) => `${routes.sales}?sale=${encodeURIComponent(id)}`,
  receipt: (id: string) => `${routes.inventoryReceipts}?receipt=${encodeURIComponent(id)}`,
} as const

function sheetPath(base: string, key: string, id: string, opts?: { edit?: boolean }) {
  const params = new URLSearchParams({ [key]: id })
  if (opts?.edit) {
    params.set('edit', '1')
  }
  return `${base}?${params.toString()}`
}

export type AppRoute = (typeof routes)[keyof typeof routes]
