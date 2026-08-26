export function parseNumber(value: string | undefined): number | null {
  const raw = (value ?? '').trim().replace(/\s/g, '').replace(',', '.')
  if (raw === '') {
    return null
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return parsed
}

export function parseBoolean(value: string | undefined): boolean | null {
  const raw = (value ?? '').trim().toLowerCase()
  if (raw === '') {
    return null
  }
  if (['1', 'true', 'yes', 'да', 'y'].includes(raw)) {
    return true
  }
  if (['0', 'false', 'no', 'нет', 'n'].includes(raw)) {
    return false
  }
  return null
}

export function parseDate(value: string | undefined): string | null {
  const raw = (value ?? '').trim()
  if (raw === '') {
    return null
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) {
    return raw
  }
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw)
  if (ru) {
    return `${ru[3]}-${ru[2]}-${ru[1]}`
  }
  return null
}

export function parseDateTime(value: string | undefined): string | null {
  const raw = (value ?? '').trim()
  if (raw === '') {
    return null
  }
  const date = parseDate(raw.slice(0, 10))
  if (date && raw.length === 10) {
    return `${date}T00:00:00.000Z`
  }
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) {
    return parseDate(raw) ? `${parseDate(raw)}T00:00:00.000Z` : null
  }
  return new Date(parsed).toISOString()
}

export function missingIfEmpty(fields: Record<string, string | number | null | undefined>): string[] {
  return Object.entries(fields)
    .filter(([, value]) => value === null || value === undefined || value === '')
    .map(([key]) => key)
}
