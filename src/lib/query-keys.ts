export const queryKeys = {
  dashboard: ['dashboard'] as const,
  users: {
    all: ['users'] as const,
    list: (filters: { search: string; roleId: string; status: string; page: number }) =>
      ['users', 'list', filters] as const,
  },
  roles: {
    all: ['roles'] as const,
    detail: (id: string) => ['roles', 'detail', id] as const,
    assignable: ['roles', 'assignable'] as const,
  },
  permissions: {
    all: ['permissions'] as const,
  },
  references: {
    all: ['references'] as const,
    sets: ['references', 'sets'] as const,
    items: (setId: string) => ['references', 'items', setId] as const,
    itemsByCode: (code: string) => ['references', 'items-by-code', code] as const,
    itemUsage: (itemId: string) => ['references', 'usage', itemId] as const,
  },
  fields: {
    all: ['fields'] as const,
    entities: ['fields', 'entities'] as const,
    byEntity: (entityCode: string) => ['fields', 'entity', entityCode] as const,
    values: (entityCode: string, recordId: string) =>
      ['fields', 'values', entityCode, recordId] as const,
    usage: (fieldId: string) => ['fields', 'usage', fieldId] as const,
    types: ['fields', 'types'] as const,
  },
  customers: {
    all: ['customers'] as const,
    list: (filters: { search: string; page: number; kind?: string }) => ['customers', 'list', filters] as const,
    search: (filters: { query: string; page: number }) => ['customers', 'search', filters] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
    inn: (inn: string) => ['customers', 'inn', inn] as const,
  },
  devices: {
    all: ['devices'] as const,
    list: (filters: { search: string; page: number }) => ['devices', 'list', filters] as const,
    search: (query: string) => ['devices', 'search', query] as const,
    serial: (serial: string) => ['devices', 'serial', serial] as const,
    detail: (id: string) => ['devices', 'detail', id] as const,
    warrantyDefaults: ['devices', 'warranty-defaults'] as const,
  },
  orders: {
    all: ['orders'] as const,
    list: (filters: unknown) => ['orders', 'list', filters] as const,
    detail: (id: string) => ['orders', 'detail', id] as const,
    transitions: (id: string) => ['orders', 'transitions', id] as const,
    history: (id: string) => ['orders', 'history', id] as const,
    attachments: (id: string) => ['orders', 'attachments', id] as const,
    diagnostics: (id: string) => ['orders', 'diagnostics', id] as const,
    previewNumber: ['orders', 'preview-number'] as const,
    workflow: ['orders', 'workflow'] as const,
    settings: ['orders', 'settings'] as const,
    statusCatalog: ['orders', 'status-catalog'] as const,
    statusGroups: ['orders', 'status-groups'] as const,
  },
  inventory: {
    all: ['inventory'] as const,
    stock: (filters: { search: string; page: number; stock?: string }) => ['inventory', 'stock', filters] as const,
    items: (filters: { search: string; page: number }) => ['inventory', 'items', filters] as const,
    item: (id: string) => ['inventory', 'item', id] as const,
    name: (name: string) => ['inventory', 'name', name] as const,
    barcode: (code: string) => ['inventory', 'barcode', code] as const,
    receipts: (page: number) => ['inventory', 'receipts', page] as const,
    receipt: (id: string) => ['inventory', 'receipt', id] as const,
    adjustments: (page: number) => ['inventory', 'adjustments', page] as const,
    counts: (filters: { status: string; page: number }) => ['inventory', 'counts', filters] as const,
    count: (id: string) => ['inventory', 'count', id] as const,
    countLines: (id: string, filters: { search: string; filter: string; page: number }) =>
      ['inventory', 'count-lines', id, filters] as const,
    countStatement: (id: string) => ['inventory', 'count-statement', id] as const,
    orderUsage: (orderId: string) => ['inventory', 'order', orderId] as const,
  },
  services: {
    all: ['services'] as const,
    templates: (filters: { search: string; page: number; activeOnly: boolean }) =>
      ['services', 'templates', filters] as const,
    orderLines: (orderId: string) => ['services', 'order', orderId] as const,
  },
  sales: {
    all: ['sales'] as const,
    list: (filters: { search: string; status: string; page: number }) =>
      ['sales', 'list', filters] as const,
    detail: (id: string) => ['sales', 'detail', id] as const,
  },
  documents: {
    all: ['documents'] as const,
    list: (filters: {
      search: string
      kind: string
      sourceType?: string
      sourceId?: string | null
      page: number
      pageSize: number
    }) => ['documents', 'list', filters] as const,
    detail: (id: string) => ['documents', 'detail', id] as const,
    templates: (filters: { kind: string; search: string }) =>
      ['documents', 'templates', filters] as const,
    template: (id: string) => ['documents', 'template', id] as const,
    context: (sourceType: string, sourceId: string) =>
      ['documents', 'context', sourceType, sourceId] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    list: (filters: {
      search: string
      assigneeId: string
      status: string
      priority: string
      due: string
      linked: string
      orderId?: string | null
      page: number
      pageSize: number
    }) => ['tasks', 'list', filters] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
    openCount: ['tasks', 'open-count'] as const,
  },
  employees: {
    active: ['employees', 'active'] as const,
  },
  audit: {
    all: ['audit'] as const,
    list: (filters: {
      search: string
      actorId: string
      entityType: string
      action: string
      fromDate: string
      toDate: string
      page: number
      pageSize: number
    }) => ['audit', 'list', filters] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: ['notifications', 'list'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
    settings: ['notifications', 'settings'] as const,
    telegram: ['notifications', 'telegram'] as const,
  },
}
