import DOMPurify from 'dompurify'
import QRCode from 'qrcode'

import { buildCode128Path } from './barcode'
import { interpolateTemplate } from './interpolate'
import type { DocumentContext, TemplateBlock } from './template-schema'

const FIELD_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)?)\s*\}\}/g

export function templateHtml(blocks: TemplateBlock[]): string {
  const htmlBlock = blocks.find((block) => block.type === 'html')
  if (htmlBlock && htmlBlock.type === 'html' && htmlBlock.html.trim()) {
    return htmlBlock.html
  }
  return blocks.map(blockToHtml).join('')
}

export function htmlTemplateBody(html: string, id?: string): TemplateBlock[] {
  return [{ id: id ?? crypto.randomUUID(), type: 'html', html }]
}

export function sanitizeDocumentHtml(html: string) {
  return DOMPurify.sanitize(html, {
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
      'colspan',
      'rowspan',
      'border',
      'cellpadding',
      'cellspacing',
      'data-code',
      'data-field',
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
  return root.innerHTML
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
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) {
    texts.push(walker.currentNode as Text)
  }
  for (const text of texts) {
    text.data = interpolateTemplate(text.data, values)
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
    return `<p><span class="doc-field">{{${block.key}}}</span></p>`
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
  return escapeHtml(value).replace(FIELD_PATTERN, (_full, key: string) => {
    return `<span class="doc-field">{{${key}}}</span>`
  })
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
