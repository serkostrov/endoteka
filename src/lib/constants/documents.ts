export const DocumentKind = {
  ActAcceptance: 'act_acceptance',
  ActCompletedWork: 'act_completed_work',
  Waybill: 'waybill',
  Label: 'label',
  Custom: 'custom',
} as const

export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind]

export const documentKindLabels: Record<DocumentKind, string> = {
  act_acceptance: 'Акт приёма-передачи',
  act_completed_work: 'Акт выполненных работ',
  waybill: 'Накладная',
  label: 'Этикетка',
  custom: 'Свой шаблон',
}

export function isDocumentKind(value: string): value is DocumentKind {
  return value in documentKindLabels
}

export const DocumentStatus = {
  Draft: 'draft',
  Issued: 'issued',
} as const

export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus]

export const documentStatusLabels: Record<DocumentStatus, string> = {
  draft: 'Черновик',
  issued: 'Выпущен',
}

export function isDocumentStatus(value: string): value is DocumentStatus {
  return value in documentStatusLabels
}

export function documentStatusTone(status: DocumentStatus) {
  return status === DocumentStatus.Issued ? ('success' as const) : ('neutral' as const)
}

export const DocumentSourceType = {
  Order: 'order',
  Sale: 'sale',
  Item: 'item',
  None: 'none',
} as const

export type DocumentSourceType = (typeof DocumentSourceType)[keyof typeof DocumentSourceType]

export const documentSourceTypeLabels: Record<DocumentSourceType, string> = {
  order: 'Заказ',
  sale: 'Продажа',
  item: 'Номенклатура',
  none: 'Без объекта',
}

export function isDocumentSourceType(value: string): value is DocumentSourceType {
  return value in documentSourceTypeLabels
}

export const DocumentPageSize = {
  A4: 'a4',
  Label: 'label',
} as const

export type DocumentPageSize = (typeof DocumentPageSize)[keyof typeof DocumentPageSize]

export const documentPageSizeLabels: Record<DocumentPageSize, string> = {
  a4: 'A4',
  label: 'Этикетка',
}

export function isDocumentPageSize(value: string): value is DocumentPageSize {
  return value in documentPageSizeLabels
}

export function sourceTypeForTemplate(kind: DocumentKind, code = '') {
  if (code === 'label_part') {
    return DocumentSourceType.Item
  }
  if (kind === DocumentKind.Waybill) {
    return DocumentSourceType.Sale
  }
  if (kind === DocumentKind.Custom) {
    return DocumentSourceType.None
  }
  return DocumentSourceType.Order
}

export const DOCUMENTS_PAGE_SIZE = 20
export const DOCUMENTS_SEARCH_DEBOUNCE_MS = 300
