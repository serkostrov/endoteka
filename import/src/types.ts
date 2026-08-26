export const ImportPhase = {
  Full: 'full',
  Delta: 'delta',
} as const

export type ImportPhase = (typeof ImportPhase)[keyof typeof ImportPhase]

export const DatasetId = {
  Employees: 'employees',
  Customers: 'customers',
  DeviceModels: 'device_models',
  WarehouseItems: 'warehouse_items',
  Barcodes: 'barcodes',
  Prices: 'prices',
  WarehouseStock: 'warehouse_stock',
  Orders: 'orders',
  OrderConsumption: 'order_consumption',
} as const

export type DatasetId = (typeof DatasetId)[keyof typeof DatasetId]

export const DATASET_ORDER: DatasetId[] = [
  DatasetId.Employees,
  DatasetId.Customers,
  DatasetId.DeviceModels,
  DatasetId.WarehouseItems,
  DatasetId.Barcodes,
  DatasetId.Prices,
  DatasetId.WarehouseStock,
  DatasetId.Orders,
  DatasetId.OrderConsumption,
]

export const DATASET_FILES: Record<DatasetId, string> = {
  employees: 'employees.csv',
  customers: 'customers.csv',
  device_models: 'device-models.csv',
  warehouse_items: 'warehouse-items.csv',
  barcodes: 'barcodes.csv',
  prices: 'prices.csv',
  warehouse_stock: 'warehouse-stock.csv',
  orders: 'orders.csv',
  order_consumption: 'order-consumption.csv',
}

export type RowStatus = 'created' | 'updated' | 'skipped' | 'failed'

export type CsvRow = Record<string, string>

export type RowIssue = {
  code: string
  message: string
}

export type RowOutcome = {
  dataset: DatasetId
  rowNumber: number
  sourceKey: string | null
  status: RowStatus
  entityType?: string
  entityId?: string
  missingFields: string[]
  errorCode?: string
  errorMessage?: string
  payload: CsvRow
}

export type ImportTotals = {
  processed: number
  created: number
  updated: number
  skipped: number
  failed: number
}

export type ImportReport = {
  runId: string
  phase: ImportPhase
  dryRun: boolean
  status: 'preview' | 'completed' | 'failed' | 'interrupted'
  totals: ImportTotals
  byDataset: Record<string, ImportTotals>
  rows: RowOutcome[]
  startedAt: string
  finishedAt: string
}

export type SourceKeyRecord = {
  dataset: string
  sourceKey: string
  entityType: string
  entityId: string
  payloadHash: string
}

export type ImportRun = {
  id: string
  phase: ImportPhase
  status: string
  dryRun: boolean
}

export type EmployeeRecord = {
  id: string
  email: string
  fullName: string
  roleCode: string
  isActive: boolean
}

export type CustomerRecord = {
  id: string
  name: string
  kind: string
  inn: string
  kpp: string
  ogrn: string
  phone: string
  email: string
  city: string
  contactName: string
  notes: string
}

export type ReferenceItemRecord = {
  id: string
  setCode: string
  code: string
  name: string
  parentId: string | null
}

export type ItemRecord = {
  id: string
  code: string
  name: string
  article: string
  barcode: string
  categoryId: string
  unitId: string
  purchasePrice: number
  repairPrice: number
  retailPrice: number
}

export type DeviceRecord = {
  id: string
  serialNumber: string
  customerId: string | null
  groupId: string | null
  brandId: string | null
  modelId: string | null
  modificationId: string | null
}

export type OrderRecord = {
  id: string
  number: string
  customerId: string
  deviceId: string
  serialNumber: string
  claimedMalfunction: string
  completeness: string
  externalCondition: string
  deadline: string | null
  responsibleId: string | null
  statusId: string
  createdAt: string
}

export type BatchRecord = {
  id: string
  itemId: string
  remainingQuantity: number
  purchasePrice: number
  receiptDate: string
}
