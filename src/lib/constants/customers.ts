export const CustomerKind = {
  Organization: 'organization',
  Individual: 'individual',
} as const

export type CustomerKind = (typeof CustomerKind)[keyof typeof CustomerKind]

export const customerKindLabels: Record<CustomerKind, string> = {
  organization: 'Организация',
  individual: 'Физлицо',
}

export function isCustomerKind(value: string): value is CustomerKind {
  return value === CustomerKind.Organization || value === CustomerKind.Individual
}

export const CUSTOMER_PAGE_SIZE = 20
export const CUSTOMER_PICKER_PAGE_SIZE = 20
export const CUSTOMER_SEARCH_DEBOUNCE_MS = 300
