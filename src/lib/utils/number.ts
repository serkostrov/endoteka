/** Тысячи — обычный пробел; без запятых как разделителя разрядов. */

function groupThousands(digits: string) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function splitSigned(value: number) {
  const sign = value < 0 ? '-' : ''
  return { sign, abs: Math.abs(value) }
}

/** Целые счётчики: 4003 → «4 003». */
export function formatInteger(value: number) {
  if (!Number.isFinite(value)) {
    return '0'
  }
  const rounded = Math.trunc(value)
  const { sign, abs } = splitSigned(rounded)
  return `${sign}${groupThousands(String(abs))}`
}

/**
 * Количества и остатки: тысячи пробелом, дробная часть через точку.
 * 4003 → «4 003», 4.5 → «4.5», 4003.25 → «4 003.25».
 */
export function formatQuantity(value: number) {
  if (!Number.isFinite(value)) {
    return '0'
  }
  const { sign, abs } = splitSigned(value)
  const rounded = Math.round(abs * 1000) / 1000
  const whole = Math.trunc(rounded)
  const frac = Math.round((rounded - whole) * 1000)
  const grouped = groupThousands(String(whole))
  if (frac === 0) {
    return `${sign}${grouped}`
  }
  const fracText = String(frac).padStart(3, '0').replace(/0+$/, '')
  return `${sign}${grouped}.${fracText}`
}

/** Деньги: тысячи пробелом, копейки через запятую — «4 003,00». */
export function formatMoney(value: number) {
  if (!Number.isFinite(value)) {
    return '0,00'
  }
  const { sign, abs } = splitSigned(value)
  const rounded = Math.round(abs * 100) / 100
  const whole = Math.trunc(rounded)
  const kopecks = Math.round((rounded - whole) * 100)
  return `${sign}${groupThousands(String(whole))},${String(kopecks).padStart(2, '0')}`
}
