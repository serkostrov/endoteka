export type AssemblyCompletenessTone = 'danger' | 'warning' | 'success'

export type AssemblyPartQuantities = {
  qtyRequired: number
  qtyCollected: number
}

/** Комплектность = sum(min(collected, required)) / sum(required) × 100. Без позиций — 0%. */
export function calcCompletenessPct(parts: AssemblyPartQuantities[]): number {
  let required = 0
  let collected = 0
  for (const part of parts) {
    const qtyRequired = Math.max(0, Number(part.qtyRequired) || 0)
    const qtyCollected = Math.max(0, Number(part.qtyCollected) || 0)
    required += qtyRequired
    collected += Math.min(qtyCollected, qtyRequired)
  }
  if (required <= 0) {
    return 0
  }
  return Math.min(100, Math.round((100 * collected) / required * 100) / 100)
}

export function completenessTone(pct: number): AssemblyCompletenessTone {
  if (pct >= 100) {
    return 'success'
  }
  if (pct >= 50) {
    return 'warning'
  }
  return 'danger'
}

export function formatCompletenessPct(pct: number): string {
  const value = Number.isFinite(pct) ? pct : 0
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(2)}%`
}
