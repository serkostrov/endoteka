import type { Json } from '@/types/database'

import { isPlaceholderKey, type PlaceholderKey } from './placeholders'

export const TemplateBlockType = {
  Heading: 'heading',
  Paragraph: 'paragraph',
  Text: 'text',
  Table: 'table',
  Image: 'image',
  Placeholder: 'placeholder',
  Qr: 'qr',
  Barcode: 'barcode',
  Html: 'html',
} as const

export type TemplateBlockType = (typeof TemplateBlockType)[keyof typeof TemplateBlockType]

export const TableSource = {
  Manual: 'manual',
  OrderParts: 'order.parts',
  SaleLines: 'sale.lines',
} as const

export type TableSource = (typeof TableSource)[keyof typeof TableSource]

export type HeadingBlock = {
  id: string
  type: 'heading'
  level: 1 | 2 | 3
  text: string
}

export type ParagraphBlock = {
  id: string
  type: 'paragraph'
  text: string
}

export type TextBlock = {
  id: string
  type: 'text'
  text: string
}

export type TableBlock = {
  id: string
  type: 'table'
  source: TableSource
  headers: string[]
  columns: string[]
  cells: string[][]
}

export type ImageBlock = {
  id: string
  type: 'image'
  url: string
  alt: string
}

export type PlaceholderBlock = {
  id: string
  type: 'placeholder'
  key: PlaceholderKey
}

export type QrBlock = {
  id: string
  type: 'qr'
  value: string
}

export type BarcodeBlock = {
  id: string
  type: 'barcode'
  value: string
}

/** Поля страницы (отступы содержимого), мм. */
export type PageMarginsMm = {
  top: number
  right: number
  bottom: number
  left: number
}

export const DEFAULT_PAGE_MARGINS_MM: PageMarginsMm = {
  top: 10,
  right: 10,
  bottom: 10,
  left: 10,
}

export const DEFAULT_LABEL_MARGINS_MM: PageMarginsMm = {
  top: 3,
  right: 3,
  bottom: 3,
  left: 3,
}

export type HtmlBlock = {
  id: string
  type: 'html'
  html: string
  /** Отступы от краёв листа (как поля / колонтитулы), мм. */
  margins?: PageMarginsMm
}

export type TemplateBlock =
  | HeadingBlock
  | ParagraphBlock
  | TextBlock
  | TableBlock
  | ImageBlock
  | PlaceholderBlock
  | QrBlock
  | BarcodeBlock
  | HtmlBlock

export type DocumentContext = {
  values: Record<string, string>
  parts: Record<string, string>[]
  lines: Record<string, string>[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }
  return value.map((item) => asString(item))
}

function parseLevel(value: unknown): 1 | 2 | 3 {
  const parsed = Number(value)
  if (parsed === 2 || parsed === 3) {
    return parsed
  }
  return 1
}

function parseTableSource(value: unknown): TableSource {
  if (value === TableSource.OrderParts || value === TableSource.SaleLines) {
    return value
  }
  return TableSource.Manual
}

function parseCells(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[][]
  }
  return value.map((row) => (Array.isArray(row) ? row.map((cell) => asString(cell)) : []))
}

export function parseTemplateBlock(value: unknown): TemplateBlock | null {
  const row = asRecord(value)
  if (!row || typeof row.id !== 'string' || typeof row.type !== 'string') {
    return null
  }

  if (row.type === TemplateBlockType.Heading) {
    return { id: row.id, type: 'heading', level: parseLevel(row.level), text: asString(row.text) }
  }
  if (row.type === TemplateBlockType.Paragraph) {
    return { id: row.id, type: 'paragraph', text: asString(row.text) }
  }
  if (row.type === TemplateBlockType.Text) {
    return { id: row.id, type: 'text', text: asString(row.text) }
  }
  if (row.type === TemplateBlockType.Table) {
    const headers = asStringArray(row.headers)
    const columns = asStringArray(row.columns)
    return {
      id: row.id,
      type: 'table',
      source: parseTableSource(row.source),
      headers: headers.length > 0 ? headers : ['Колонка'],
      columns: columns.length > 0 ? columns : headers.map(() => ''),
      cells: parseCells(row.cells),
    }
  }
  if (row.type === TemplateBlockType.Image) {
    return { id: row.id, type: 'image', url: asString(row.url), alt: asString(row.alt) }
  }
  if (row.type === TemplateBlockType.Placeholder) {
    const key = asString(row.key)
    if (!isPlaceholderKey(key)) {
      return null
    }
    return { id: row.id, type: 'placeholder', key }
  }
  if (row.type === TemplateBlockType.Qr) {
    return { id: row.id, type: 'qr', value: asString(row.value) }
  }
  if (row.type === TemplateBlockType.Barcode) {
    return { id: row.id, type: 'barcode', value: asString(row.value) }
  }
  if (row.type === TemplateBlockType.Html) {
    const margins = parsePageMargins(row.margins)
    return {
      id: row.id,
      type: 'html',
      html: asString(row.html),
      ...(margins ? { margins } : {}),
    }
  }

  return null
}

function parseMarginMm(value: unknown, fallback: number) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    return fallback
  }
  return Math.min(80, Math.max(0, Math.round(n * 10) / 10))
}

export function parsePageMargins(value: unknown): PageMarginsMm | null {
  const row = asRecord(value)
  if (!row) {
    return null
  }
  return {
    top: parseMarginMm(row.top, DEFAULT_PAGE_MARGINS_MM.top),
    right: parseMarginMm(row.right, DEFAULT_PAGE_MARGINS_MM.right),
    bottom: parseMarginMm(row.bottom, DEFAULT_PAGE_MARGINS_MM.bottom),
    left: parseMarginMm(row.left, DEFAULT_PAGE_MARGINS_MM.left),
  }
}

export function normalizePageMargins(
  value: PageMarginsMm | null | undefined,
  pageSize: 'a4' | 'label' = 'a4',
): PageMarginsMm {
  // A4: единые фиксированные поля 10 мм — без пользовательской настройки
  if (pageSize !== 'label') {
    return { ...DEFAULT_PAGE_MARGINS_MM }
  }
  const defaults = DEFAULT_LABEL_MARGINS_MM
  if (!value) {
    return { ...defaults }
  }
  return {
    top: parseMarginMm(value.top, defaults.top),
    right: parseMarginMm(value.right, defaults.right),
    bottom: parseMarginMm(value.bottom, defaults.bottom),
    left: parseMarginMm(value.left, defaults.left),
  }
}

/** Поля страницы из html-блока шаблона. */
export function templatePageMargins(
  blocks: TemplateBlock[],
  pageSize: 'a4' | 'label' = 'a4',
): PageMarginsMm {
  const htmlBlock = blocks.find((block) => block.type === 'html')
  if (htmlBlock && htmlBlock.type === 'html') {
    return normalizePageMargins(htmlBlock.margins, pageSize)
  }
  return normalizePageMargins(undefined, pageSize)
}

export function parseTemplateBody(value: Json | unknown): TemplateBlock[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    const parsed = parseTemplateBlock(item)
    return parsed ? [parsed] : []
  })
}

function asStringMap(value: unknown): Record<string, string> {
  const row = asRecord(value)
  if (!row) {
    return {}
  }
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(row)) {
    if (typeof item === 'string' || typeof item === 'number') {
      result[key] = String(item)
    }
  }
  return result
}

export function parseDocumentContext(value: Json | unknown): DocumentContext {
  const row = asRecord(value)
  if (!row) {
    return { values: {}, parts: [], lines: [] }
  }

  return {
    values: asStringMap(row.values),
    parts: Array.isArray(row.parts) ? row.parts.map((item) => asStringMap(item)) : [],
    lines: Array.isArray(row.lines) ? row.lines.map((item) => asStringMap(item)) : [],
  }
}

export function emptyTemplateBody(): TemplateBlock[] {
  return [createHtmlBlock(DEFAULT_TEMPLATE_HTML)]
}

export function createHtmlBlock(html: string, margins?: PageMarginsMm): HtmlBlock {
  return {
    id: crypto.randomUUID(),
    type: 'html',
    html,
    ...(margins ? { margins: normalizePageMargins(margins) } : {}),
  }
}

const DEFAULT_TEMPLATE_HTML = `<p style="text-align: center;"><strong>{{company.name}}</strong></p>
<hr>
<p style="text-align: center;"><strong>АКТ ПРИЁМА-ПЕРЕДАЧИ {{order.number}}</strong></p>
<p>г. {{customer.city}} ________________________________________________________________ {{document.issuedAt}}</p>
<p>Клиент: <span class="doc-field" data-field="customer.name">{{customer.name}}</span></p>
<p>Прибор: <span class="doc-field" data-field="device.label">{{device.label}}</span></p>
<p>Серийный номер: <span class="doc-field" data-field="device.serialNumber">{{device.serialNumber}}</span></p>
<p>Сопроводительная записка: <span class="doc-field" data-field="order.claimedMalfunction">{{order.claimedMalfunction}}</span></p>
<p>Комплектация: <span class="doc-field" data-field="order.completeness">{{order.completeness}}</span></p>
<p>&nbsp;</p>
<table style="width: 100%; border-collapse: collapse;">
<tbody>
<tr>
<td style="width: 50%;">Сдал</td>
<td style="width: 50%;">Принял</td>
</tr>
<tr>
<td>________________ / ________________</td>
<td>________________ / ________________</td>
</tr>
</tbody>
</table>`

export function createBlock(type: TemplateBlockType): TemplateBlock {
  const id = crypto.randomUUID()
  if (type === TemplateBlockType.Heading) {
    return { id, type: 'heading', level: 1, text: 'Заголовок' }
  }
  if (type === TemplateBlockType.Paragraph) {
    return { id, type: 'paragraph', text: 'Текст абзаца. Можно вставить {{order.number}}.' }
  }
  if (type === TemplateBlockType.Text) {
    return { id, type: 'text', text: '' }
  }
  if (type === TemplateBlockType.Table) {
    return {
      id,
      type: 'table',
      source: TableSource.Manual,
      headers: ['Колонка 1', 'Колонка 2'],
      columns: ['', ''],
      cells: [
        ['', ''],
        ['', ''],
      ],
    }
  }
  if (type === TemplateBlockType.Image) {
    return { id, type: 'image', url: '', alt: '' }
  }
  if (type === TemplateBlockType.Placeholder) {
    return { id, type: 'placeholder', key: 'order.number' }
  }
  if (type === TemplateBlockType.Qr) {
    return { id, type: 'qr', value: '{{order.number}}' }
  }
  return { id, type: 'barcode', value: '{{item.barcode}}' }
}
