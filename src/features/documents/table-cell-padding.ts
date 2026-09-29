import { syncMceInlineStyle } from './sync-mce-style'

/** Ячейки только этой таблицы (без вложенных). */
export function ownTableCells(table: HTMLTableElement): HTMLElement[] {
  return [...table.querySelectorAll<HTMLElement>('td, th')].filter((cell) => cell.closest('table') === table)
}

/**
 * Записывает padding ячейки longhands + shorthand.
 * Так top/bottom не теряются при сериализации TinyMCE и не перебиваются CSS.
 */
export function setCellPadding(cell: HTMLElement, padY: string, padX: string) {
  const y = ensurePt(padY)
  const x = ensurePt(padX)
  writePadding(cell, y, y, x, x)
  const table = cell.closest('table')
  if (table) {
    clearFixedTableHeights(table)
  }
}

/** Верх/низ отдельно (для кнопки «Отступы»), горизонталь сохраняем. */
export function setCellPaddingY(cell: HTMLElement, padTop: string, padBottom: string) {
  const top = ensurePt(padTop)
  const bottom = ensurePt(padBottom)
  const left = ensurePt(cell.style.paddingLeft || readPaddingSide(cell, 'left') || '5pt')
  const right = ensurePt(cell.style.paddingRight || readPaddingSide(cell, 'right') || left)
  writePadding(cell, top, bottom, left, right)
  const table = cell.closest('table')
  if (table) {
    clearFixedTableHeights(table)
  }
}

/**
 * TinyMCE при ресайзе строк пишет tr{height:27px} / table{height:…}.
 * При padding:0 текст «висит» в середине высокой строки — кажется, что есть отступы.
 * min-height ячеек (поля «прочие дефекты») не трогаем.
 */
export function clearFixedTableHeights(table: HTMLTableElement) {
  stripHeight(table)
  for (const row of table.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr')) {
    if ((row as HTMLElement).closest('table') !== table) continue
    stripHeight(row as HTMLElement)
  }
  for (const cell of ownTableCells(table)) {
    stripHeight(cell)
    syncMceInlineStyle(cell)
  }
  syncMceInlineStyle(table)
}

function writePadding(cell: HTMLElement, top: string, bottom: string, left: string, right: string) {
  const style = cell.getAttribute('style') || ''
  const cleaned = style
    .replace(/(?:^|;)\s*padding(?:-(?:top|right|bottom|left))?\s*:[^;]*/gi, '')
    .replace(/(?:^|;)\s*vertical-align\s*:[^;]*/gi, '')
    .replace(/(?:^|;)\s*height\s*:[^;]*/gi, '')
    .replace(/^\s*;\s*|\s*;\s*$/g, '')
    .replace(/;;+/g, ';')
    .trim()
  const shorthand =
    top === bottom && left === right
      ? top === left
        ? `padding: ${top}`
        : `padding: ${top} ${left}`
      : `padding: ${top} ${right} ${bottom} ${left}`
  const longhands = `padding-top: ${top}; padding-bottom: ${bottom}; padding-left: ${left}; padding-right: ${right}`
  const next = [cleaned, shorthand, longhands, 'vertical-align: middle']
    .filter(Boolean)
    .join('; ')
    .replace(/\s*;\s*;/g, '; ')
  cell.setAttribute('style', next)
  cell.style.paddingTop = top
  cell.style.paddingBottom = bottom
  cell.style.paddingLeft = left
  cell.style.paddingRight = right
  cell.style.verticalAlign = 'middle'
  cell.style.removeProperty('height')
  cell.removeAttribute('height')
  compactCellInner(cell)
  syncMceInlineStyle(cell)
}

/** Убирает ложные «отступы» внутри ячейки: margin у <p>, пустые абзацы. */
export function compactCellInner(cell: HTMLElement) {
  const paragraphs = [...cell.querySelectorAll<HTMLElement>(':scope > p')]
  for (const p of paragraphs) {
    const ps = p.getAttribute('style') || ''
    const cleaned = ps
      .replace(/(?:^|;)\s*margin(?:-(?:top|right|bottom|left))?\s*:[^;]*/gi, '')
      .replace(/(?:^|;)\s*padding(?:-(?:top|right|bottom|left))?\s*:[^;]*/gi, '')
      .replace(/;;+/g, ';')
      .replace(/^\s*;\s*|\s*;\s*$/g, '')
      .trim()
    const next = [cleaned, 'margin: 0', 'padding: 0'].filter(Boolean).join('; ')
    p.setAttribute('style', next)
    p.style.margin = '0'
    p.style.padding = '0'
    syncMceInlineStyle(p)
  }

  for (const p of [...paragraphs]) {
    if (!p.isConnected) continue
    const text = (p.textContent || '').replace(/\u00a0/g, ' ').trim()
    if (!text && !p.querySelector('img,table,.doc-field,.doc-qr,.doc-barcode')) {
      p.remove()
    }
  }
}

function stripHeight(el: HTMLElement) {
  el.style.removeProperty('height')
  el.removeAttribute('height')
  stripStyleProps(el, ['height'])
  syncMceInlineStyle(el)
}

function stripStyleProps(el: HTMLElement, props: string[]) {
  let style = el.getAttribute('style') || ''
  if (!style) return
  for (const prop of props) {
    const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    style = style.replace(new RegExp(`(?:^|;)\\s*${escaped}\\s*:[^;]*`, 'gi'), '')
  }
  style = style
    .replace(/;;+/g, ';')
    .replace(/^\s*;\s*|\s*;\s*$/g, '')
    .trim()
  if (style) el.setAttribute('style', style)
  else el.removeAttribute('style')
}

function ensurePt(value: string): string {
  const v = String(value ?? '').trim()
  if (!v) return '0pt'
  if (/pt|px|em|rem|mm|%$/i.test(v)) return v === '0' ? '0pt' : v
  if (/^\d+(\.\d+)?$/.test(v)) return `${v}pt`
  return v
}

function readPaddingSide(el: HTMLElement, side: 'left' | 'right'): string {
  const raw = el.style.getPropertyValue('padding') || ''
  if (!raw) {
    const long = side === 'left' ? el.style.paddingLeft : el.style.paddingRight
    if (long) return long
    const mce = el.getAttribute('data-mce-style') || ''
    const re = new RegExp(`(?:^|;)\\s*padding-${side}\\s*:\\s*([^;]+)`, 'i')
    const m = mce.match(re)
    if (m?.[1]) return m[1].trim()
    return ''
  }
  const parts = raw.trim().split(/\s+/)
  if (parts.length === 1) return parts[0] ?? ''
  if (parts.length === 2) return parts[1] ?? ''
  if (parts.length === 3) return parts[1] ?? ''
  if (parts.length >= 4) return side === 'left' ? (parts[3] ?? '') : (parts[1] ?? '')
  return ''
}
