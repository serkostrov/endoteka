import { placeholderKeySet } from './placeholders'

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)?)\s*\}\}/g

export function interpolateTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_full, key: string) => {
    if (!placeholderKeySet.has(key)) {
      return ''
    }
    return values[key] ?? ''
  })
}
