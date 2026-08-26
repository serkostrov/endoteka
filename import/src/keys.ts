const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'j',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

export function slugCode(value: string): string {
  const mapped = [...value.trim().toLowerCase()]
    .map((char) => CYRILLIC[char] ?? char)
    .join('')
  const slug = mapped.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
  if (!slug) {
    return ''
  }
  return slug.replace(/^[^a-z]/, 'x$&').slice(0, 64)
}

export function normalizeToken(value: string | undefined): string {
  return (value ?? '').trim()
}

export function normalizeEmail(value: string | undefined): string {
  return normalizeToken(value).toLowerCase()
}

export function identityFromSourceId(dataset: string, sourceId: string | undefined): string | null {
  const id = normalizeToken(sourceId)
  if (!id) {
    return null
  }
  return `ext:${dataset}:${id}`
}

export function identityFromNatural(dataset: string, parts: Array<string | null | undefined>): string | null {
  const tokens = parts.map((part) => normalizeToken(part ?? ''))
  if (tokens.some((token) => token === '')) {
    return null
  }
  return `nat:${dataset}:${tokens.join('|').toLowerCase()}`
}

export type IdentityResult =
  | { key: string; strategy: 'external' | 'natural' }
  | { error: string }

export function resolveIdentity(
  dataset: string,
  sourceId: string | undefined,
  naturalParts: Array<{ label: string; value: string | null | undefined }>,
): IdentityResult {
  const external = identityFromSourceId(dataset, sourceId)
  if (external) {
    return { key: external, strategy: 'external' }
  }

  const missing = naturalParts.filter((part) => normalizeToken(part.value ?? '') === '').map((part) => part.label)
  if (missing.length > 0) {
    return {
      error: `Нет идентификатора источника и не хватает полей для точного сопоставления: ${missing.join(', ')}.`,
    }
  }

  const natural = identityFromNatural(
    dataset,
    naturalParts.map((part) => part.value),
  )
  if (!natural) {
    return { error: 'Нельзя определить стабильный ключ записи.' }
  }
  return { key: natural, strategy: 'natural' }
}
