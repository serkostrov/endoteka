export const WarrantyStatus = {
  Upcoming: 'upcoming',
  Active: 'active',
  Expired: 'expired',
} as const

export type WarrantyStatus = (typeof WarrantyStatus)[keyof typeof WarrantyStatus]

export const warrantyStatusLabels: Record<WarrantyStatus, string> = {
  upcoming: 'Ещё не началась',
  active: 'Действует',
  expired: 'Истекла',
}

export function isWarrantyStatus(value: string | null | undefined): value is WarrantyStatus {
  return Boolean(value && Object.values(WarrantyStatus).includes(value as WarrantyStatus))
}

export const SERIAL_LOOKUP_DEBOUNCE_MS = 300
export const SERIAL_LOOKUP_MIN_LENGTH = 2
export const DEVICE_PAGE_SIZE = 20
