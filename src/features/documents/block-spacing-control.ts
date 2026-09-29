import type { Editor as TinyMCEEditor } from 'tinymce'

import { notifyEditorContentChanged } from './notify-editor-change'
import { ownTableCells, setCellPaddingY, compactCellInner, clearFixedTableHeights } from './table-cell-padding'
import { syncMceInlineStyle } from './sync-mce-style'

type SpacingTarget =
  | { kind: 'cells'; table: HTMLTableElement; label: string }
  | { kind: 'block'; el: HTMLElement; label: string }
  | { kind: 'image'; el: HTMLImageElement; label: string }

/**
 * «Отступы» — как в Word:
 * • в таблице → поля ячеек (padding) всей этой таблицы;
 * • на абзаце/заголовке → интервал до и после (видимый зазор, с учётом соседей);
 * • на картинке → внешние отступы.
 */
export function registerBlockSpacingControl(editor: TinyMCEEditor) {
  editor.ui.registry.addButton('blockspacing', {
    text: 'Отступы',
    tooltip: 'Поля ячеек или интервал до/после абзаца',
    onAction: () => openBlockSpacingDialog(editor),
  })

  editor.ui.registry.addMenuItem('blockspacing', {
    text: 'Отступы сверху / снизу…',
    onAction: () => openBlockSpacingDialog(editor),
  })

  editor.ui.registry.addContextMenu('blockspacing', {
    update: (element) => {
      if (!element || element.closest?.('[data-doc-page-gap]')) {
        return ''
      }
      return 'blockspacing'
    },
  })
}

export function openBlockSpacingDialog(editor: TinyMCEEditor) {
  const target = resolveSpacingTarget(editor)
  if (!target) {
    editor.notificationManager.open({
      text: 'Поставьте курсор на абзац, таблицу или картинку',
      type: 'info',
      timeout: 2500,
    })
    return
  }

  const initial = readSpacing(target)
  const { title, hint, topLabel, bottomLabel } = dialogCopy(target)

  editor.windowManager.open({
    title,
    size: 'normal',
    body: {
      type: 'panel',
      items: [
        {
          type: 'htmlpanel',
          html: `<p style="margin:0 0 10px;font:13px/1.4 system-ui,sans-serif;color:#475569;">${hint}</p>`,
        },
        {
          type: 'grid',
          columns: 2,
          items: [
            { type: 'input', name: 'top', label: topLabel, inputMode: 'decimal', placeholder: '0' },
            { type: 'input', name: 'bottom', label: bottomLabel, inputMode: 'decimal', placeholder: '0' },
          ],
        },
        {
          type: 'htmlpanel',
          html: '<p style="margin:14px 0 2px;font:600 12px/1.2 system-ui,sans-serif;color:#334155;">Быстро</p>',
        },
        {
          type: 'listbox',
          name: 'preset',
          label: 'Пресет (оба значения)',
          items: [
            { text: 'Не менять', value: '' },
            { text: 'Нет (0)', value: '0' },
            { text: '2 pt', value: '2' },
            { text: '3 pt', value: '3' },
            { text: '4 pt', value: '4' },
            { text: '6 pt', value: '6' },
            { text: '8 pt', value: '8' },
            { text: '12 pt', value: '12' },
          ],
        },
      ],
    },
    initialData: { ...initial, preset: '' },
    buttons: [
      { type: 'cancel', text: 'Отмена' },
      { type: 'submit', text: 'Применить', buttonType: 'primary' },
    ],
    onSubmit: (api) => {
      const data = api.getData() as { top?: string; bottom?: string; preset?: string }
      const preset = String(data.preset ?? '').trim()
      let top = String(data.top ?? '')
      let bottom = String(data.bottom ?? '')
      if (preset !== '') {
        top = preset
        bottom = preset
      }
      const topCss = normalizeSpacingValue(top)
      const bottomCss = normalizeSpacingValue(bottom)
      if (topCss === null || bottomCss === null) {
        editor.windowManager.alert('Укажите число от 0 до 200 (pt)')
        return
      }
      api.close()
      editor.undoManager.transact(() => {
        applySpacing(target, topCss, bottomCss)
        editor.focus()
      })
      notifyEditorContentChanged(editor)
    },
  })
}

function dialogCopy(target: SpacingTarget): {
  title: string
  hint: string
  topLabel: string
  bottomLabel: string
} {
  if (target.kind === 'cells') {
    return {
      title: 'Поля ячеек',
      hint:
        'Внутренние отступы <strong>всех ячеек</strong> этой таблицы. Единицы: pt (0, 2, 4…). ' +
        'При применении сбрасываются зафиксированные высоты строк TinyMCE — из‑за них при 0 казалось, что отступы остались.',
      topLabel: 'Сверху',
      bottomLabel: 'Снизу',
    }
  }
  if (target.kind === 'image') {
    return {
      title: 'Отступы — картинка',
      hint: 'Внешние отступы вокруг картинки. Единицы: pt.',
      topLabel: 'Сверху',
      bottomLabel: 'Снизу',
    }
  }
  return {
    title: `Интервал — ${target.label}`,
    hint:
      'Зазор <strong>до</strong> и <strong>после</strong> этого блока (как в Word). ' +
      'Учитывается и соседняя таблица: 0 сверху убирает пустое место над заголовком. Единицы: pt.',
    topLabel: 'Перед',
    bottomLabel: 'После',
  }
}

function resolveSpacingTarget(editor: TinyMCEEditor): SpacingTarget | null {
  const node = editor.selection.getNode() as HTMLElement | null
  if (!node || node.nodeType !== 1) {
    return null
  }
  if (node.closest?.('[data-doc-page-gap]') || node.hasAttribute?.('data-doc-page-gap')) {
    return null
  }

  const img = editor.dom.getParent(node, 'img') as HTMLImageElement | null
  if (img) {
    return { kind: 'image', el: img, label: 'Картинка' }
  }

  // Абзац вне ячейки — «ТЕХНИЧЕСКОЕ СОСТОЯНИЕ», заголовок акта и т.п.
  const textBlock = editor.dom.getParent(node, 'p,h1,h2,h3,h4,h5,h6') as HTMLElement | null
  if (textBlock && !editor.dom.getParent(textBlock, 'td,th') && !textBlock.closest('[data-doc-page-gap]')) {
    const tag = textBlock.tagName
    return {
      kind: 'block',
      el: textBlock,
      label: tag === 'P' ? 'Абзац' : `Заголовок ${tag}`,
    }
  }

  const cell = editor.dom.getParent(node, 'td,th') as HTMLElement | null
  if (cell) {
    const table = cell.closest('table') as HTMLTableElement | null
    if (table) {
      return { kind: 'cells', table, label: 'Ячейки таблицы' }
    }
  }

  const table = editor.dom.getParent(node, 'table') as HTMLTableElement | null
  if (table) {
    return { kind: 'cells', table, label: 'Ячейки таблицы' }
  }

  const block = editor.dom.getParent(node, 'div,li') as HTMLElement | null
  if (block && block !== editor.getBody() && !block.closest('[data-doc-page-gap]')) {
    return { kind: 'block', el: block, label: 'Блок' }
  }

  return null
}

function readSpacing(target: SpacingTarget): { top: string; bottom: string } {
  if (target.kind === 'cells') {
    const sample = ownTableCells(target.table)[0]
    if (!sample) {
      return { top: '0', bottom: '0' }
    }
    return {
      top: stripUnit(readSide(sample, 'padding', 'top')),
      bottom: stripUnit(readSide(sample, 'padding', 'bottom')),
    }
  }

  if (target.kind === 'image') {
    return {
      top: stripUnit(readSide(target.el, 'margin', 'top')),
      bottom: stripUnit(readSide(target.el, 'margin', 'bottom')),
    }
  }

  return readBlockGap(target.el)
}

/**
 * Видимый зазор = свой отступ + вклад соседа (margin у таблицы над заголовком и т.п.).
 */
function readBlockGap(el: HTMLElement): { top: string; bottom: string } {
  const prev = previousFlowSibling(el)
  const next = nextFlowSibling(el)
  const ownTop = lengthToPt(readSide(el, 'padding', 'top')) || lengthToPt(readSide(el, 'margin', 'top'))
  const ownBottom =
    lengthToPt(readSide(el, 'padding', 'bottom')) || lengthToPt(readSide(el, 'margin', 'bottom'))
  const prevBottom = prev ? lengthToPt(readSide(prev, 'margin', 'bottom')) : 0
  const nextTop = next ? lengthToPt(readSide(next, 'margin', 'top')) : 0
  return {
    top: String(roundPt(ownTop + prevBottom)),
    bottom: String(roundPt(ownBottom + nextTop)),
  }
}

function applySpacing(target: SpacingTarget, top: string, bottom: string) {
  if (target.kind === 'cells') {
    clearFixedTableHeights(target.table)
    for (const cell of ownTableCells(target.table)) {
      setCellPaddingY(cell, top, bottom)
      compactCellInner(cell)
    }
    clearFixedTableHeights(target.table)
    return
  }

  if (target.kind === 'image') {
    setVerticalMargin(target.el, top, bottom)
    syncMceInlineStyle(target.el)
    return
  }

  applyBlockGap(target.el, top, bottom)
}

/**
 * Интервал до/после блока: мы «владеем» зазором —
 * обнуляем вертикальный margin соседей и пишем значение на сам блок через padding
 * (padding не схлопывается с margin таблицы).
 */
function applyBlockGap(el: HTMLElement, before: string, after: string) {
  const prev = previousFlowSibling(el)
  const next = nextFlowSibling(el)
  if (prev) {
    clearVerticalSide(prev, 'bottom')
  }
  if (next) {
    clearVerticalSide(next, 'top')
  }

  const align = el.style.textAlign
  const lh = el.style.lineHeight
  const ml = readSide(el, 'margin', 'left')
  const mr = readSide(el, 'margin', 'right')
  const pl = readSide(el, 'padding', 'left')
  const pr = readSide(el, 'padding', 'right')

  stripCssProps(el, [
    'margin',
    'margin-top',
    'margin-bottom',
    'margin-left',
    'margin-right',
    'padding',
    'padding-top',
    'padding-bottom',
    'padding-left',
    'padding-right',
  ])

  el.style.setProperty('margin-top', '0')
  el.style.setProperty('margin-bottom', '0')
  if (ml && !isZeroLength(ml)) el.style.setProperty('margin-left', ensurePt(ml))
  if (mr && !isZeroLength(mr)) el.style.setProperty('margin-right', ensurePt(mr))

  el.style.setProperty('padding-top', before)
  el.style.setProperty('padding-bottom', after)
  if (pl && !isZeroLength(pl)) el.style.setProperty('padding-left', ensurePt(pl))
  if (pr && !isZeroLength(pr)) el.style.setProperty('padding-right', ensurePt(pr))

  if (align) el.style.textAlign = align
  if (lh) el.style.lineHeight = lh
  syncMceInlineStyle(el)
}

function clearVerticalSide(el: HTMLElement, side: 'top' | 'bottom') {
  const keepAlign = el.style.textAlign
  const lh = el.style.lineHeight
  const isTable = el.tagName === 'TABLE'

  // До strip читаем горизонталь (у таблиц часто margin: 0 auto 6pt)
  const ml = readSide(el, 'margin', 'left') || el.style.marginLeft
  const mr = readSide(el, 'margin', 'right') || el.style.marginRight
  const mt = side === 'top' ? '0' : readSide(el, 'margin', 'top') || '0'
  const mb = side === 'bottom' ? '0' : readSide(el, 'margin', 'bottom') || '0'
  const wasAuto =
    ml === 'auto' ||
    mr === 'auto' ||
    /\bauto\b/i.test(el.style.margin || '') ||
    /\bauto\b/i.test(el.getAttribute('style') || '')

  stripCssProps(el, ['margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'])

  el.style.setProperty('margin-top', isZeroLength(mt) ? '0' : ensurePt(mt))
  el.style.setProperty('margin-bottom', isZeroLength(mb) ? '0' : ensurePt(mb))
  if (wasAuto || isTable) {
    // Таблицы в акте центрируются через auto
    el.style.setProperty('margin-left', 'auto')
    el.style.setProperty('margin-right', 'auto')
  } else {
    if (ml && ml !== 'auto' && !isZeroLength(ml)) el.style.setProperty('margin-left', ensurePt(ml))
    if (mr && mr !== 'auto' && !isZeroLength(mr)) el.style.setProperty('margin-right', ensurePt(mr))
  }

  // У абзацев мог остаться padding с прошлой версии «Отступов» — обнуляем нужную сторону
  if (!isTable) {
    const padProp = side === 'top' ? 'padding-top' : 'padding-bottom'
    el.style.setProperty(padProp, '0')
  }

  if (keepAlign) el.style.textAlign = keepAlign
  if (lh) el.style.lineHeight = lh
  syncMceInlineStyle(el)
}

function setVerticalMargin(el: HTMLElement, top: string, bottom: string) {
  const ml = readSide(el, 'margin', 'left')
  const mr = readSide(el, 'margin', 'right')
  stripCssProps(el, ['margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'])
  el.style.setProperty('margin-top', top)
  el.style.setProperty('margin-bottom', bottom)
  if (ml) el.style.setProperty('margin-left', ml)
  if (mr) el.style.setProperty('margin-right', mr)
}

function previousFlowSibling(el: HTMLElement): HTMLElement | null {
  let n = el.previousElementSibling as HTMLElement | null
  while (n) {
    if (!isIgnorableSibling(n)) return n
    n = n.previousElementSibling as HTMLElement | null
  }
  return null
}

function nextFlowSibling(el: HTMLElement): HTMLElement | null {
  let n = el.nextElementSibling as HTMLElement | null
  while (n) {
    if (!isIgnorableSibling(n)) return n
    n = n.nextElementSibling as HTMLElement | null
  }
  return null
}

function isIgnorableSibling(el: HTMLElement): boolean {
  if (el.hasAttribute('data-doc-page-gap') || el.hasAttribute('data-mce-bogus')) {
    return true
  }
  // Пустой абзац-распорка
  if (el.tagName === 'P' && !el.textContent?.replace(/\u00a0/g, ' ').trim() && !el.querySelector('img')) {
    return false // пустой p всё же занимает место — не игнорируем, а учитываем
  }
  return false
}

function readSide(
  el: HTMLElement,
  shorthand: 'margin' | 'padding',
  side: 'top' | 'right' | 'bottom' | 'left',
): string {
  const longhand = `${shorthand}-${side}`
  const direct =
    el.style.getPropertyValue(longhand) ||
    (shorthand === 'margin'
      ? side === 'top'
        ? el.style.marginTop
        : side === 'bottom'
          ? el.style.marginBottom
          : side === 'left'
            ? el.style.marginLeft
            : el.style.marginRight
      : side === 'top'
        ? el.style.paddingTop
        : side === 'bottom'
          ? el.style.paddingBottom
          : side === 'left'
            ? el.style.paddingLeft
            : el.style.paddingRight)
  if (direct) return direct
  const fromShort = readShorthandSide(el, shorthand, side)
  if (fromShort) return fromShort
  // data-mce-style — источник правды для сериализации TinyMCE
  const mce = el.getAttribute('data-mce-style') || ''
  if (mce) {
    const re = new RegExp(`(?:^|;)\\s*${longhand}\\s*:\\s*([^;]+)`, 'i')
    const m = mce.match(re)
    if (m?.[1]) return m[1].trim()
    const shortRe = new RegExp(`(?:^|;)\\s*${shorthand}\\s*:\\s*([^;]+)`, 'i')
    const sm = mce.match(shortRe)
    if (sm?.[1]) return pickFromShorthand(sm[1].trim(), side)
  }
  return ''
}

function pickFromShorthand(raw: string, side: 'top' | 'right' | 'bottom' | 'left'): string {
  const parts = raw.trim().split(/\s+/)
  if (parts.length === 1) return parts[0] ?? ''
  if (parts.length === 2) return side === 'top' || side === 'bottom' ? (parts[0] ?? '') : (parts[1] ?? '')
  if (parts.length === 3) {
    if (side === 'top') return parts[0] ?? ''
    if (side === 'bottom') return parts[2] ?? ''
    return parts[1] ?? ''
  }
  if (parts.length >= 4) {
    if (side === 'top') return parts[0] ?? ''
    if (side === 'right') return parts[1] ?? ''
    if (side === 'bottom') return parts[2] ?? ''
    return parts[3] ?? ''
  }
  return ''
}

function readShorthandSide(
  el: HTMLElement,
  shorthand: 'margin' | 'padding',
  side: 'top' | 'right' | 'bottom' | 'left',
): string {
  const raw = el.style.getPropertyValue(shorthand) || ''
  if (!raw) return ''
  return pickFromShorthand(raw, side)
}

function normalizeSpacingValue(raw: string): string | null {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(',', '.')
    .replace(/\s+/g, '')
  if (!cleaned) return '0'
  const match = cleaned.match(/^(-?[\d.]+)(pt|px|mm|cm|em|%)?$/i)
  if (!match) return null
  const num = Number.parseFloat(match[1] ?? '')
  if (!Number.isFinite(num) || num < 0 || num > 200) return null
  const unit = (match[2] || 'pt').toLowerCase()
  return `${Math.round(num * 100) / 100}${unit}`
}

function stripUnit(value: string): string {
  const v = String(value ?? '').trim()
  if (!v || v === '0px' || v === '0') return '0'
  const m = v.match(/^(-?[\d.]+)(pt|px|mm|cm|em|%)?$/i)
  if (!m) return v
  const num = Number.parseFloat(m[1] ?? '')
  if (!Number.isFinite(num)) return v
  if ((m[2] || '').toLowerCase() === 'px') return String(Math.round((num * 72) / 96))
  return String(Math.round(num * 100) / 100)
}

function lengthToPt(value: string): number {
  const v = String(value ?? '').trim()
  if (!v || isZeroLength(v)) return 0
  const m = v.match(/^(-?[\d.]+)(pt|px|mm|cm|em|%)?$/i)
  if (!m) return 0
  const num = Number.parseFloat(m[1] ?? '')
  if (!Number.isFinite(num)) return 0
  const unit = (m[2] || 'pt').toLowerCase()
  if (unit === 'px') return (num * 72) / 96
  if (unit === 'mm') return (num * 72) / 25.4
  if (unit === 'cm') return (num * 72) / 2.54
  return num
}

function roundPt(n: number): number {
  return Math.round(n * 100) / 100
}

function isZeroLength(value: string): boolean {
  return /^0(pt|px|mm|cm|em|%)?$/i.test(String(value).trim())
}

function ensurePt(value: string): string {
  const v = String(value).trim()
  if (!v) return '0'
  if (v === 'auto') return 'auto'
  if (/^[\d.]+$/.test(v)) return `${v}pt`
  return v
}

function stripCssProps(el: HTMLElement, props: string[]) {
  for (const prop of props) {
    el.style.removeProperty(prop)
  }
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
