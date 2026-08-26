export const SaleStatus = {
  Draft: 'draft',
  Confirmed: 'confirmed',
  Cancelled: 'cancelled',
} as const

export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus]

export const saleStatusLabels: Record<SaleStatus, string> = {
  draft: 'Черновик',
  confirmed: 'Подтверждена',
  cancelled: 'Отменена',
}

export function isSaleStatus(value: string): value is SaleStatus {
  return value in saleStatusLabels
}

export function saleStatusTone(status: SaleStatus) {
  if (status === SaleStatus.Confirmed) {
    return 'success' as const
  }
  if (status === SaleStatus.Cancelled) {
    return 'warning' as const
  }
  return 'neutral' as const
}

export const SALES_PAGE_SIZE = 20
export const SALES_SEARCH_DEBOUNCE_MS = 300
