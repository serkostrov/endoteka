/** Без группировки для количеств; деньги — с пробелом тысяч и копейками через запятую. */

function splitSigned(value: number) {
  const sign = value < 0 ? '-' : ''
  return { sign, abs: Math.abs(value) }
}

/** Группы по 3 цифры: 1250000 → «1 250 000». */
function groupThousands(digits: string, separator = ' ') {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
}

/** Целые счётчики: 4003 → «4003». */
export function formatInteger(value: number) {
  if (!Number.isFinite(value)) {
    return '0'
  }
  const rounded = Math.trunc(value)
  const { sign, abs } = splitSigned(rounded)
  return `${sign}${abs}`
}

/**
 * Количества и остатки — строго целые (округление до ближайшего).
 * 4003 → «4003», 1.003 → «1», 4.6 → «5».
 */
export function formatQuantity(value: number) {
  return formatInteger(Math.round(value))
}

/** Разбор количества: только целое число (не ноль для списаний/приходов — проверяйте отдельно). */
export function parseQuantity(raw: string): number | null {
  const normalized = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (!normalized) {
    return null
  }
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null
  }
  return parsed
}

/** Деньги: неразрывный пробел тысяч, копейки через запятую — «1 250 000,00». */
export function formatMoney(value: number) {
  if (!Number.isFinite(value)) {
    return '0,00'
  }
  const { sign, abs } = splitSigned(value)
  const rounded = Math.round(abs * 100) / 100
  const whole = Math.trunc(rounded)
  const kopecks = Math.round((rounded - whole) * 100)
  return `${sign}${groupThousands(String(whole), '\u00a0')},${String(kopecks).padStart(2, '0')}`
}

/** Разбор ввода цены: «6 666,00», «6666.5», «6666». */
export function parseMoney(raw: string): number | null {
  const normalized = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (!normalized) {
    return null
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}
