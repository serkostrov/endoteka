import DOMPurify from 'dompurify'
import QRCode from 'qrcode'

import { buildCode128Path } from './barcode'
import { interpolateTemplate, isResolvablePlaceholderKey, resolvePlaceholderValue } from './interpolate'
import type { DocumentContext, PageMarginsMm, TemplateBlock } from './template-schema'
import { normalizePageMargins } from './template-schema'

const FIELD_PATTERN =
  /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)(?:\|([^}]+))?\s*\}\}/g

export function templateHtml(blocks: TemplateBlock[]): string {
  const htmlBlock = blocks.find((block) => block.type === 'html')
  if (htmlBlock && htmlBlock.type === 'html' && htmlBlock.html.trim()) {
    return htmlBlock.html
  }
  return blocks.map(blockToHtml).join('')
}

export function htmlTemplateBody(
  html: string,
  id?: string,
  margins?: PageMarginsMm,
): TemplateBlock[] {
  return [
    {
      id: id ?? crypto.randomUUID(),
      type: 'html',
      html,
      margins: normalizePageMargins(margins),
    },
  ]
}

export function sanitizeDocumentHtml(html: string) {
  return DOMPurify.sanitize(normalizeTableColumnWidths(html), {
    ALLOWED_TAGS: [
      'p',
      'br',
      'hr',
      'div',
      'span',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'strike',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'colgroup',
      'col',
      'caption',
      'tr',
      'th',
      'td',
      'img',
      'ul',
      'ol',
      'li',
      'a',
      'blockquote',
      'sup',
      'sub',
      'font',
      'svg',
      'path',
      'text',
    ],
    ALLOWED_ATTR: [
      'class',
      'style',
      'src',
      'alt',
      'href',
      'target',
      'rel',
      'width',
      'height',
      'span',
      'colspan',
      'rowspan',
      'border',
      'cellpadding',
      'cellspacing',
      'data-code',
      'data-field',
      'data-date-format',
      'viewBox',
      'd',
      'stroke',
      'stroke-width',
      'fill',
      'x',
      'y',
      'text-anchor',
      'font-size',
      'role',
      'aria-label',
    ],
    ALLOW_DATA_ATTR: true,
  })
}

/**
 * TinyMCE хранит ширины колонок в <colgroup>/<col> (и иногда только в data-mce-style).
 * Перед печатью/превью поднимаем их в style, собираем colgroup и переводим абсолютные
 * ширины в % — иначе px/pt с холста редактора вылезают за поля листа.
 */
export function normalizeTableColumnWidths(html: string) {
  if (typeof DOMParser === 'undefined' || !html.includes('<table')) {
    return html
  }

  const parsed = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = parsed.getElementById('root')
  if (!root) {
    return html
  }

  for (const el of root.querySelectorAll('col, td, th, table')) {
    promoteMceStyle(el)
  }

  for (const table of root.querySelectorAll('table')) {
    ensureColgroupFromCells(table)
    convertAbsoluteColumnWidthsToPercent(table)
    // Если есть colgroup — ширины только там; px на td снова раздувают таблицу в Chrome print.
    if (table.querySelector(':scope > colgroup, :scope > col')) {
      for (const cell of table.querySelectorAll('td, th')) {
        stripWidth(cell)
      }
    }
    clampTableToPageWidth(table)
  }

  for (const el of root.querySelectorAll('[style], [width], [height]')) {
    stripPrintOverflowHints(el)
  }

  return root.innerHTML
}

function promoteMceStyle(el: Element) {
  const mce = el.getAttribute('data-mce-style')?.trim()
  if (!mce) {
    return
  }
  const current = el.getAttribute('style')?.trim() || ''
  if (!current) {
    el.setAttribute('style', mce)
  } else if (!/\bwidth\s*:/i.test(current) && /\bwidth\s*:/i.test(mce)) {
    el.setAttribute('style', `${current.replace(/;?\s*$/, '')}; ${mce}`)
  }
  el.removeAttribute('data-mce-style')
}

function ensureColgroupFromCells(table: HTMLTableElement) {
  if (table.querySelector(':scope > colgroup, :scope > col')) {
    return
  }
  const firstRow = table.rows[0]
  if (!firstRow) {
    return
  }
  const widths = [...firstRow.cells].map((cell) => {
    const fromStyle = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(cell.getAttribute('style') || '')?.[1]?.trim()
    return fromStyle || cell.getAttribute('width')?.trim() || ''
  })
  if (!widths.some(Boolean)) {
    return
  }

  const colgroup = table.ownerDocument.createElement('colgroup')
  for (const width of widths) {
    const col = table.ownerDocument.createElement('col')
    if (width) {
      col.setAttribute('style', `width: ${width}`)
    }
    colgroup.appendChild(col)
  }
  table.insertBefore(colgroup, table.firstChild)
}

function readWidthToken(el: Element): string {
  const fromStyle = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(el.getAttribute('style') || '')?.[1]?.trim()
  if (fromStyle) {
    return fromStyle
  }
  return el.getAttribute('width')?.trim() || ''
}

function parseWidthToNumber(token: string): { value: number; unit: 'px' | 'pt' | 'mm' | '%' | 'other' } | null {
  const match = /^([\d.]+)\s*(px|pt|mm|%)?$/i.exec(token.trim())
  if (!match) {
    return null
  }
  const value = Number.parseFloat(match[1] ?? '')
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  const unit = (match[2]?.toLowerCase() || 'px') as 'px' | 'pt' | 'mm' | '%'
  return { value, unit }
}

/** Абсолютные ширины колонок → доли %, чтобы таблица умещалась в ширину листа. */
function convertAbsoluteColumnWidthsToPercent(table: HTMLTableElement) {
  const cols = [...table.querySelectorAll(':scope > colgroup col, :scope > col')]
  const targets: Element[] =
    cols.length > 0
      ? cols
      : table.rows[0]
        ? [...table.rows[0].cells]
        : []
  if (targets.length === 0) {
    return
  }

  const parsed = targets.map((el) => parseWidthToNumber(readWidthToken(el)))
  const hasAbsolute = parsed.some((item) => item && item.unit !== '%')
  if (!hasAbsolute) {
    // Уже проценты — нормализуем сумму к 100%, если разъехалась.
    const percents = parsed.map((item) => (item && item.unit === '%' ? item.value : 0))
    const sum = percents.reduce((acc, value) => acc + value, 0)
    if (sum > 100.5 || (sum > 0 && sum < 99.5 && percents.every((value) => value > 0))) {
      applyPercentWidths(targets, percents)
    }
    return
  }

  const weights = parsed.map((item) => {
    if (!item) {
      return 0
    }
    if (item.unit === '%') {
      return item.value
    }
    if (item.unit === 'pt') {
      return item.value * (96 / 72)
    }
    if (item.unit === 'mm') {
      return item.value * (96 / 25.4)
    }
    return item.value
  })
  if (!weights.some((value) => value > 0)) {
    return
  }

  applyPercentWidths(targets, weights)

  // Ширины на ячейках первой строки больше не нужны — источник правды colgroup.
  if (cols.length > 0 && table.rows[0]) {
    for (const cell of table.rows[0].cells) {
      stripWidth(cell)
    }
  }
}

function applyPercentWidths(targets: Element[], weights: number[]) {
  const total = weights.reduce((acc, value) => acc + value, 0)
  if (total <= 0) {
    return
  }
  let assigned = 0
  targets.forEach((el, index) => {
    const isLast = index === targets.length - 1
    let pct = isLast
      ? Math.max(0, Math.round((100 - assigned) * 100) / 100)
      : Math.round(((weights[index] ?? 0) / total) * 10000) / 100
    if (!isLast) {
      assigned += pct
    }
    if (pct <= 0 && !isLast) {
      return
    }
    setWidthPercent(el, pct)
  })
}

function setWidthPercent(el: Element, pct: number) {
  const style = (el.getAttribute('style') || '')
    .replace(/(?:^|;)\s*width\s*:[^;]*/gi, '')
    .replace(/;;+/g, ';')
    .replace(/^;|;$/g, '')
    .trim()
  const next = style ? `${style}; width: ${pct}%` : `width: ${pct}%`
  el.setAttribute('style', next)
  el.removeAttribute('width')
}

function stripWidth(el: Element) {
  const style = (el.getAttribute('style') || '')
    .replace(/(?:^|;)\s*width\s*:[^;]*/gi, '')
    .replace(/;;+/g, ';')
    .replace(/^;|;$/g, '')
    .trim()
  if (style) {
    el.setAttribute('style', style)
  } else {
    el.removeAttribute('style')
  }
  el.removeAttribute('width')
}

function clampTableToPageWidth(table: HTMLTableElement) {
  let style = (table.getAttribute('style') || '')
    .replace(/(?:^|;)\s*width\s*:[^;]*/gi, '')
    .replace(/(?:^|;)\s*max-width\s*:[^;]*/gi, '')
    .replace(/(?:^|;)\s*min-width\s*:[^;]*/gi, '')
    .replace(/(?:^|;)\s*table-layout\s*:[^;]*/gi, '')
    .replace(/(?:^|;)\s*margin(?:-left|-right)?\s*:[^;]*/gi, '')
    .replace(/;;+/g, ';')
    .replace(/^;|;$/g, '')
    .trim()

  style = [
    style,
    'width: 100%',
    'max-width: 100%',
    'table-layout: fixed',
    'box-sizing: border-box',
    'margin-left: 0',
    'margin-right: 0',
  ]
    .filter(Boolean)
    .join('; ')

  table.setAttribute('style', style)
  table.removeAttribute('width')
}

/** Убирает CSS, из‑за которого Chrome в системном preview обрезает правый край. */
function stripPrintOverflowHints(el: Element) {
  if (el instanceof HTMLTableElement || el.tagName === 'COL' || el.tagName === 'COLGROUP') {
    return
  }

  let style = el.getAttribute('style') || ''
  if (!style && !el.hasAttribute('width')) {
    return
  }

  style = style
    .replace(/(?:^|;)\s*min-width\s*:[^;]*/gi, '')
    .replace(/(?:^|;)\s*white-space\s*:\s*nowrap\s*/gi, '')
    .replace(/;;+/g, ';')
    .replace(/^;|;$/g, '')
    .trim()

  const widthToken = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim()
  const parsed = widthToken ? parseWidthToNumber(widthToken) : null
  if (parsed && parsed.unit !== '%') {
    const px =
      parsed.unit === 'pt'
        ? parsed.value * (96 / 72)
        : parsed.unit === 'mm'
          ? parsed.value * (96 / 25.4)
          : parsed.value
    // Широкие блоки с холста A4 — в % от листа; мелкие (логотип и т.п.) не трогаем.
    if (px >= 400 && el.tagName !== 'IMG' && el.tagName !== 'SVG') {
      style = style
        .replace(/(?:^|;)\s*width\s*:[^;]*/gi, '')
        .replace(/;;+/g, ';')
        .replace(/^;|;$/g, '')
        .trim()
      style = style ? `${style}; width: 100%; max-width: 100%` : 'width: 100%; max-width: 100%'
    }
  }

  if (style) {
    el.setAttribute('style', style)
  } else {
    el.removeAttribute('style')
  }

  if (el.tagName !== 'IMG' && el.tagName !== 'SVG') {
    const widthAttr = el.getAttribute('width')
    if (widthAttr && Number.parseFloat(widthAttr) >= 400) {
      el.removeAttribute('width')
    }
  }
}

export async function renderFilledDocumentHtml(html: string, context: DocumentContext) {
  const prepared = prepareDocumentHtml(html, context)
  const qrValues = collectAttrValues(prepared, '.doc-qr')
  const qrMap = qrValues.length > 0 ? await buildQrMap(qrValues) : {}
  return sanitizeDocumentHtml(embedVisualCodes(prepared, qrMap))
}

export function collectAttrValues(html: string, selector: string) {
  if (typeof DOMParser === 'undefined') {
    return [] as string[]
  }
  const parsed = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = parsed.getElementById('root')
  if (!root) {
    return []
  }
  return [
    ...new Set(
      [...root.querySelectorAll(selector)]
        .map((node) => node.getAttribute('data-code')?.trim() ?? '')
        .filter(Boolean),
    ),
  ]
}

export async function buildQrMap(values: string[]) {
  const entries = await Promise.all(
    values.map(async (value) => {
      const url = await QRCode.toDataURL(value, { margin: 1, width: 160, errorCorrectionLevel: 'M' })
      return [value, url] as const
    }),
  )
  return Object.fromEntries(entries) as Record<string, string>
}

export function embedVisualCodes(html: string, qrMap: Record<string, string>) {
  if (typeof DOMParser === 'undefined') {
    return html
  }
  const parsed = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = parsed.getElementById('root')
  if (!root) {
    return html
  }

  for (const node of root.querySelectorAll('.doc-qr')) {
    const code = node.getAttribute('data-code')?.trim() ?? ''
    const src = qrMap[code]
    if (!src) {
      continue
    }
    const image = parsed.createElement('img')
    image.setAttribute('src', src)
    image.setAttribute('alt', code)
    image.setAttribute('class', 'doc-qr-image')
    node.replaceWith(image)
  }

  for (const node of root.querySelectorAll('.doc-barcode')) {
    const code = node.getAttribute('data-code')?.trim() ?? ''
    const svg = barcodeSvgMarkup(code)
    if (!svg) {
      continue
    }
    const wrap = parsed.createElement('span')
    wrap.innerHTML = svg
    node.replaceWith(...Array.from(wrap.childNodes))
  }

  return root.innerHTML
}

export function prepareDocumentHtml(html: string, context: DocumentContext) {
  if (typeof DOMParser === 'undefined') {
    return interpolateTemplate(html, context.values)
  }

  const parsed = new DOMParser().parseFromString(`<div id="doc-root">${html}</div>`, 'text/html')
  const root = parsed.getElementById('doc-root')
  if (!root) {
    return interpolateTemplate(html, context.values)
  }

  for (const table of root.querySelectorAll('table')) {
    expandRepeatingTable(table, context)
  }

  interpolateNode(root, context.values)
  // Пустой data-code после подстановки — только из явного barcode-поля источника, без подмены кодом.
  fillEmptyBarcodeCodes(root, context.values)
  return root.innerHTML
}

function fillEmptyBarcodeCodes(root: Element, values: Record<string, string>) {
  const fallback = (
    values['item.barcode'] ||
    values['part.barcode'] ||
    values['line.barcode'] ||
    ''
  ).trim()
  if (!fallback) {
    return
  }
  for (const node of root.querySelectorAll('.doc-barcode')) {
    const code = node.getAttribute('data-code')?.trim() ?? ''
    if (!code) {
      node.setAttribute('data-code', fallback)
    }
  }
}

function expandRepeatingTable(table: HTMLTableElement, context: DocumentContext) {
  const body = table.tBodies[0]
  if (!body) {
    return
  }
  const templateRow = body.rows[0]
  if (!templateRow) {
    return
  }

  const sample = templateRow.innerHTML
  const usesParts = /\{\{\s*part\./.test(sample)
  const usesLines = /\{\{\s*line\./.test(sample)
  if (!usesParts && !usesLines) {
    interpolateNode(templateRow, context.values)
    return
  }

  const source = usesParts ? context.parts : context.lines
  const rows = source.length > 0 ? source : [{}]
  body.replaceChildren()
  for (const row of rows) {
    const clone = templateRow.cloneNode(true) as HTMLTableRowElement
    interpolateNode(clone, { ...context.values, ...row })
    body.append(clone)
  }
}

function interpolateNode(node: Element, values: Record<string, string>) {
  for (const element of node.querySelectorAll<HTMLElement>('.doc-field[data-field]')) {
    const key = element.getAttribute('data-field')?.trim() ?? ''
    if (!key) {
      continue
    }
    const dateFormat = element.getAttribute('data-date-format')?.trim() || undefined
    if (!(key in values) && !isResolvablePlaceholderKey(key)) {
      element.replaceChildren()
      continue
    }
    const raw = values[key]
    const resolved =
      raw == null || raw === '' ? '' : resolvePlaceholderValue(key, raw, dateFormat)
    setPreservedWhitespaceContent(element, resolved)
  }

  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) {
    texts.push(walker.currentNode as Text)
  }
  for (const text of texts) {
    if (text.parentElement?.closest('.doc-field[data-field]')) {
      continue
    }
    const next = interpolateTemplate(text.data, values)
    if (next === text.data) {
      continue
    }
    if (!next.includes('\n') && !next.includes('\r')) {
      text.data = next
      continue
    }
    // Плейсхолдер вне .doc-field: переносы → <br>, пробелы через pre-wrap на обёртке.
    const parent = text.parentNode
    if (!parent || !text.ownerDocument) {
      text.data = next
      continue
    }
    const wrap = text.ownerDocument.createElement('span')
    wrap.style.whiteSpace = 'pre-wrap'
    setPreservedWhitespaceContent(wrap, next)
    parent.replaceChild(wrap, text)
  }

  for (const element of node.querySelectorAll('[data-code], [src], [alt], [href]')) {
    for (const attr of ['data-code', 'src', 'alt', 'href']) {
      const value = element.getAttribute(attr)
      if (value?.includes('{{')) {
        element.setAttribute(attr, interpolateTemplate(value, values))
      }
    }
  }
}

function blockToHtml(block: TemplateBlock): string {
  if (block.type === 'html') {
    return block.html
  }
  if (block.type === 'heading') {
    return `<h${block.level}>${inlineHtml(block.text)}</h${block.level}>`
  }
  if (block.type === 'paragraph' || block.type === 'text') {
    return `<p>${inlineHtml(block.text)}</p>`
  }
  if (block.type === 'placeholder') {
    return `<p><span class="doc-field" data-field="${escapeAttr(block.key)}">{{${block.key}}}</span></p>`
  }
  if (block.type === 'image') {
    return `<p><img src="${escapeAttr(block.url)}" alt="${escapeAttr(block.alt)}" style="max-height: 12rem;"></p>`
  }
  if (block.type === 'qr') {
    return `<p><span class="doc-qr" data-code="${escapeAttr(block.value)}">QR</span></p>`
  }
  if (block.type === 'barcode') {
    return `<p><span class="doc-barcode" data-code="${escapeAttr(block.value)}">Штрихкод</span></p>`
  }
  if (block.type === 'table') {
    const head = `<thead><tr>${block.headers.map((header) => `<th>${inlineHtml(header)}</th>`).join('')}</tr></thead>`
    if (block.source === 'order.parts' || block.source === 'sale.lines') {
      const cells = block.columns.map((cell) => `<td>${inlineHtml(cell)}</td>`).join('')
      return `<table style="width: 100%; border-collapse: collapse;">${head}<tbody><tr>${cells}</tr></tbody></table>`
    }
    const body = block.cells
      .map((row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell)}</td>`).join('')}</tr>`)
      .join('')
    return `<table style="width: 100%; border-collapse: collapse;">${head}<tbody>${body}</tbody></table>`
  }
  return ''
}

function inlineHtml(value: string) {
  return escapeHtml(value).replace(FIELD_PATTERN, (_full, key: string, dateFormat?: string) => {
    const token = dateFormat ? `{{${key}|${dateFormat}}}` : `{{${key}}}`
    return `<span class="doc-field" data-field="${escapeAttr(key)}">${token}</span>`
  })
}

/** Текст поля с переносами строк и пробелами — как в форме (textarea). */
function setPreservedWhitespaceContent(element: HTMLElement, value: string) {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.includes('\n')) {
    element.textContent = normalized
    return
  }

  const doc = element.ownerDocument
  element.replaceChildren()
  const lines = normalized.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    element.appendChild(doc.createTextNode(lines[index] ?? ''))
    if (index < lines.length - 1) {
      element.appendChild(doc.createElement('br'))
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeAttr(value: string) {
  return escapeHtml(value).replaceAll('"', '&quot;')
}

export function barcodeSvgMarkup(value: string) {
  const path = buildCode128Path(value)
  if (!path) {
    return ''
  }
  return `<svg role="img" aria-label="${escapeAttr(path.payload)}" viewBox="0 0 ${path.width} ${path.height + 14}" class="doc-barcode-svg">${`<path d="${path.d}" stroke="black" stroke-width="1" fill="none"></path>`}<text x="${path.width / 2}" y="${path.height + 12}" text-anchor="middle" font-size="10">${escapeHtml(path.payload)}</text></svg>`
}
