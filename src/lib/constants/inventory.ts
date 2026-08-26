export const InventoryUnitCode = {
  Pcs: 'pcs',
  Pack: 'pack',
} as const

export type InventoryUnitCode = (typeof InventoryUnitCode)[keyof typeof InventoryUnitCode]

export const inventoryUnitCodes: InventoryUnitCode[] = [InventoryUnitCode.Pcs, InventoryUnitCode.Pack]

export const InventoryMovementType = {
  Receipt: 'receipt',
  RepairConsumption: 'repair_consumption',
  Sale: 'sale',
  InventoryAdjustment: 'inventory_adjustment',
} as const

export type InventoryMovementType = (typeof InventoryMovementType)[keyof typeof InventoryMovementType]

export const inventoryMovementTypeLabels: Record<InventoryMovementType, string> = {
  receipt: 'Приход',
  repair_consumption: 'Израсходован в ремонт',
  sale: 'Продан',
  inventory_adjustment: 'Инвентаризация',
}

export function isInventoryMovementType(value: string): value is InventoryMovementType {
  return value in inventoryMovementTypeLabels
}

export const INVENTORY_PAGE_SIZE = 20
export const INVENTORY_COUNT_LINE_PAGE_SIZE = 50
export const INVENTORY_SEARCH_DEBOUNCE_MS = 300
export const INVENTORY_SEARCH_MIN_LENGTH = 2
export const BARCODE_SCAN_IDLE_MS = 100
export const BARCODE_MIN_LENGTH = 8
export const BARCODE_MAX_LENGTH = 13

export function isAllowedInventoryUnitCode(code: string): code is InventoryUnitCode {
  return (inventoryUnitCodes as string[]).includes(code)
}

export function isScanBarcode(value: string) {
  return new RegExp(`^\\d{${BARCODE_MIN_LENGTH},${BARCODE_MAX_LENGTH}}$`).test(value.trim())
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export function formatQuantity(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)
}

export const InventoryCountStatus = {
  Draft: 'draft',
  InProgress: 'in_progress',
  Completed: 'completed',
  Cancelled: 'cancelled',
} as const

export type InventoryCountStatus = (typeof InventoryCountStatus)[keyof typeof InventoryCountStatus]

export const inventoryCountStatusLabels: Record<InventoryCountStatus, string> = {
  draft: 'Черновик',
  in_progress: 'В работе',
  completed: 'Проведена',
  cancelled: 'Отменена',
}

export function isInventoryCountStatus(value: string): value is InventoryCountStatus {
  return value in inventoryCountStatusLabels
}

export function inventoryCountStatusTone(status: InventoryCountStatus) {
  if (status === InventoryCountStatus.Completed) {
    return 'success' as const
  }
  if (status === InventoryCountStatus.InProgress) {
    return 'info' as const
  }
  if (status === InventoryCountStatus.Cancelled) {
    return 'warning' as const
  }
  return 'neutral' as const
}

export const InventoryCountLineFilter = {
  All: 'all',
  Uncounted: 'uncounted',
  Counted: 'counted',
  Discrepancy: 'discrepancy',
} as const

export type InventoryCountLineFilter = (typeof InventoryCountLineFilter)[keyof typeof InventoryCountLineFilter]

export const inventoryCountLineFilterLabels: Record<InventoryCountLineFilter, string> = {
  all: 'Все строки',
  uncounted: 'Не пересчитано',
  counted: 'Пересчитано',
  discrepancy: 'Расхождения',
}

export const InventoryCountSeedMode = {
  Empty: 'empty',
  InStock: 'in_stock',
} as const

export type InventoryCountSeedMode = (typeof InventoryCountSeedMode)[keyof typeof InventoryCountSeedMode]

