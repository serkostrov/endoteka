import { buildCode128Path } from '@/features/documents/barcode'

export const BARCODE_TYPES = ['code128', 'ean8', 'ean13', 'qr', 'upc_a'] as const

export type BarcodeType = (typeof BARCODE_TYPES)[number]

export const barcodeTypeLabels: Record<BarcodeType, string> = {
  code128: 'Code128',
  ean8: 'EAN-8',
  ean13: 'EAN-13',
  qr: 'QR-Code',
  upc_a: 'UPC-A',
}

export function isBarcodeType(value: string): value is BarcodeType {
  return (BARCODE_TYPES as readonly string[]).includes(value)
}

export type BarcodeRenderResult =
  | { kind: 'svg'; width: number; height: number; d: string; payload: string }
  | { kind: 'error'; message: string }

const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011',
] as const
const EAN_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111',
] as const
const EAN_R = [
  '1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100',
] as const
const EAN13_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
] as const

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function eanChecksum(digitsWithoutCheck: string) {
  let sum = 0
  const chars = digitsWithoutCheck.split('').reverse()
  chars.forEach((char, index) => {
    const digit = Number(char)
    sum += index % 2 === 0 ? digit * 3 : digit
  })
  return (10 - (sum % 10)) % 10
}

function ensureEanCheckDigit(body: string, totalLength: number) {
  if (body.length === totalLength) {
    return body
  }
  if (body.length === totalLength - 1) {
    return `${body}${eanChecksum(body)}`
  }
  return null
}

function modulesToPath(modules: number[], height = 48, quiet = 8) {
  const bars: string[] = []
  modules.forEach((bit, index) => {
    if (bit === 1) {
      bars.push(`M${quiet + index} 0 V${height}`)
    }
  })
  return {
    width: modules.length + quiet * 2,
    height,
    d: bars.join(' '),
  }
}

function appendPattern(modules: number[], pattern: string) {
  for (const bit of pattern) {
    modules.push(bit === '1' ? 1 : 0)
  }
}

function buildEanModules(digits: string, leftCount: number) {
  const modules: number[] = []
  appendPattern(modules, '101')

  if (digits.length === 13) {
    const parity = EAN13_PARITY[Number(digits[0])] ?? 'LLLLLL'
    for (let index = 0; index < 6; index += 1) {
      const digit = Number(digits[index + 1])
      const set = parity[index] === 'G' ? EAN_G : EAN_L
      appendPattern(modules, set[digit] ?? EAN_L[0]!)
    }
  } else {
    for (let index = 0; index < leftCount; index += 1) {
      const digit = Number(digits[index])
      appendPattern(modules, EAN_L[digit] ?? EAN_L[0]!)
    }
  }

  appendPattern(modules, '01010')

  const rightStart = digits.length === 13 ? 7 : leftCount
  for (let index = rightStart; index < digits.length; index += 1) {
    const digit = Number(digits[index])
    appendPattern(modules, EAN_R[digit] ?? EAN_R[0]!)
  }

  appendPattern(modules, '101')
  return modules
}

export function renderLinearBarcode(type: Exclude<BarcodeType, 'qr'>, raw: string): BarcodeRenderResult {
  const value = raw.trim()
  if (!value) {
    return { kind: 'error', message: 'Укажите значение штрихкода' }
  }

  if (type === 'code128') {
    const path = buildCode128Path(value)
    if (!path) {
      return { kind: 'error', message: 'Значение нельзя закодировать в Code128' }
    }
    return { kind: 'svg', ...path }
  }

  const digits = onlyDigits(value)
  if (type === 'ean8') {
    const payload = ensureEanCheckDigit(digits, 8)
    if (!payload || payload.length !== 8) {
      return { kind: 'error', message: 'EAN-8: нужно 7 или 8 цифр' }
    }
    const path = modulesToPath(buildEanModules(payload, 4))
    return { kind: 'svg', ...path, payload }
  }

  if (type === 'ean13') {
    const payload = ensureEanCheckDigit(digits, 13)
    if (!payload || payload.length !== 13) {
      return { kind: 'error', message: 'EAN-13: нужно 12 или 13 цифр' }
    }
    const path = modulesToPath(buildEanModules(payload, 6))
    return { kind: 'svg', ...path, payload }
  }

  const upcBody = digits.length === 12 ? digits : digits.length === 11 ? `${digits}${eanChecksum(digits)}` : null
  if (!upcBody || upcBody.length !== 12) {
    return { kind: 'error', message: 'UPC-A: нужно 11 или 12 цифр' }
  }
  const asEan13 = `0${upcBody}`
  const path = modulesToPath(buildEanModules(asEan13, 6))
  return { kind: 'svg', ...path, payload: upcBody }
}

export function labelPayload(barcode: string, code: string) {
  const trimmed = barcode.trim()
  return trimmed || code.trim()
}

function randomDigits(length: number) {
  let result = ''
  const values = crypto.getRandomValues(new Uint32Array(length))
  for (let index = 0; index < length; index += 1) {
    result += String((values[index] ?? 0) % 10)
  }
  return result
}

/** Новый код под выбранный тип этикетки (с контрольной цифрой для EAN/UPC). */
export function generateBarcodeValue(type: BarcodeType): string {
  if (type === 'ean8') {
    const body = randomDigits(7)
    return `${body}${eanChecksum(body)}`
  }
  if (type === 'ean13') {
    // 200–299 — внутренние коды предприятия
    const body = `2${randomDigits(11)}`
    return `${body}${eanChecksum(body)}`
  }
  if (type === 'upc_a') {
    const body = randomDigits(11)
    return `${body}${eanChecksum(body)}`
  }
  if (type === 'qr') {
    return `QR-${Date.now().toString(36).toUpperCase()}-${randomDigits(4)}`
  }
  return `C128-${Date.now().toString(36).toUpperCase()}${randomDigits(3)}`
}
