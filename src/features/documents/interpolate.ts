import {
  DEFAULT_DOCUMENT_DATE_FORMAT,
  formatDocumentDate,
  isDocumentDateKey,
  looksLikeIsoDate,
} from './date-formats'
import { isPlaceholderKey, placeholderKeySet } from './placeholders'

/** key or key|dateFormat — supports field.orders.code */
const PLACEHOLDER_PATTERN =
  /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)(?:\|([^}]+))?\s*\}\}/g

export function interpolateTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_full, key: string, dateFormat?: string) => {
    if (!(key in values) && !isResolvablePlaceholderKey(key)) {
      return ''
    }
    const raw = values[key]
    if (raw == null || raw === '') {
      return ''
    }
    return resolvePlaceholderValue(key, raw, dateFormat?.trim())
  })
}

export function isResolvablePlaceholderKey(key: string) {
  if (placeholderKeySet.has(key) || isPlaceholderKey(key)) {
    return true
  }
  return /^field\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(key)
}

export function resolvePlaceholderValue(key: string, raw: string, dateFormat?: string) {
  const format = dateFormat || (shouldAutoFormatDate(key, raw) ? DEFAULT_DOCUMENT_DATE_FORMAT : undefined)
  if (format) {
    return formatDocumentDate(raw, format)
  }
  return raw
}

function shouldAutoFormatDate(key: string, raw: string) {
  return isDocumentDateKey(key) || (looksLikeIsoDate(raw) && key.startsWith('field.'))
}
