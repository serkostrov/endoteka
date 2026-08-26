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
  ц: 'c',
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

export function slugifyCode(source: string, fallback = 'item'): string {
  const transliterated = source
    .trim()
    .toLowerCase()
    .split('')
    .map((char) => CYRILLIC[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')

  let result = transliterated
  if (!result || !/^[a-z]/.test(result)) {
    result = `${fallback}_${result}`.replace(/_+/g, '_').replace(/_+$/g, '')
  }
  if (!/^[a-z]/.test(result)) {
    result = fallback
  }

  return (result.slice(0, 64).replace(/_+$/g, '') || fallback).slice(0, 64)
}

export function uniqueCode(source: string, used: Iterable<string>, fallback = 'item'): string {
  const taken = new Set(used)
  const base = slugifyCode(source, fallback)
  if (!taken.has(base)) {
    return base
  }

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`
    const next = `${base.slice(0, 64 - suffix.length)}${suffix}`
    if (!taken.has(next)) {
      return next
    }
  }

  return `${fallback}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`.slice(0, 64)
}
