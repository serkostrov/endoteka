import type { Editor as TinyMCEEditor } from 'tinymce'

import { notifyEditorContentChanged } from './notify-editor-change'
import { syncMceInlineStyle } from './sync-mce-style'

/** Пресеты как в Word — множители line-height. */
export const LINE_HEIGHT_PRESETS = [
  { text: 'Одинарный', value: '1' },
  { text: '1,15', value: '1.15' },
  { text: '1,5', value: '1.5' },
  { text: 'Двойной', value: '2' },
  { text: '2,5', value: '2.5' },
  { text: 'Тройной', value: '3' },
] as const

const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,td,th,li,div'
const TEXT_BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI'])
const CELL = new Set(['TD', 'TH'])

/**
 * Кнопка «Интервал»: пресеты применяются ко всему документу
 * (как ожидают для межстрочки в акте), с уплотнением margin/padding.
 */
export function registerLineHeightControl(editor: TinyMCEEditor) {
  editor.on('init', () => {
    editor.formatter.register('lineheight', {
      selector: BLOCK_SELECTOR,
      styles: { 'line-height': '%value' },
    })
  })

  editor.ui.registry.addMenuButton('doclineheight', {
    text: 'Интервал',
    tooltip: 'Межстрочный интервал всего документа',
    icon: 'line-height',
    fetch: (callback) => {
      const current = normalizeLineHeight(readDocumentLineHeight(editor))
      const items = [
        ...LINE_HEIGHT_PRESETS.map((preset) => ({
          type: 'togglemenuitem' as const,
          text: preset.text,
          active: current === preset.value,
          onAction: () => applyLineHeightToEntireDocument(editor, preset.value),
        })),
        { type: 'separator' as const },
        {
          type: 'menuitem' as const,
          text: 'Свой…',
          onAction: () => openCustomLineHeightDialog(editor, current),
        },
        {
          type: 'menuitem' as const,
          text: 'По умолчанию (1,15)',
          onAction: () => applyLineHeightToEntireDocument(editor, '1.15'),
        },
      ]
      callback(items)
    },
  })
}

function applyLineHeightToEntireDocument(editor: TinyMCEEditor, value: string) {
  const normalized = normalizeLineHeight(value)
  if (!normalized) {
    return
  }
  editor.undoManager.transact(() => {
    const body = editor.getBody()
    if (!body) {
      return
    }
    body.style.lineHeight = normalized

    const nodes = [...body.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)]
    for (const block of nodes) {
      if (block.closest('[data-doc-page-gap]') || block.hasAttribute('data-doc-page-gap')) {
        continue
      }
      applySpacingToBlock(block, normalized)
    }
    // Таблицы тоже — у них часто margin: 0 auto 12pt
    for (const table of body.querySelectorAll<HTMLElement>('table')) {
      if (table.closest('[data-doc-page-gap]')) {
        continue
      }
      applySpacingToBlock(table, normalized)
    }
  })
  notifyEditorContentChanged(editor)
}

function applySpacingToBlock(block: HTMLElement, lineHeight: string) {
  const lh = Number.parseFloat(lineHeight)

  if (TEXT_BLOCK.has(block.tagName)) {
    // Важно: сбросить shorthand margin: 14pt 0 8pt — иначе top/bottom «не меняются»
    const align = block.style.textAlign
    stripCssProps(block, ['margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'])
    const insideCell = Boolean(block.parentElement && CELL.has(block.parentElement.tagName))
    if (insideCell) {
      block.style.margin = '0'
      block.style.padding = '0'
    } else {
      // Компактные внешние отступы секций («ТЕХНИЧЕСКОЕ СОСТОЯНИЕ» и т.п.)
      block.style.marginTop = paragraphBeforeMargin(lh)
      block.style.marginRight = '0'
      block.style.marginBottom = paragraphAfterMargin(lh)
      block.style.marginLeft = '0'
    }
    if (align) {
      block.style.textAlign = align
    }
  }

  if (CELL.has(block.tagName)) {
    // Не трогаем padding ячеек — им управляют «Свойства таблицы» / «Отступы».
    // Раньше cellPadY(1.15) = 1pt затирал вертикальные отступы во всех таблицах.
    for (const p of block.querySelectorAll<HTMLElement>(':scope > p')) {
      stripCssProps(p, ['margin', 'margin-top', 'margin-bottom', 'padding'])
      p.style.margin = '0'
      p.style.padding = '0'
      p.style.lineHeight = lineHeight
      syncMceInlineStyle(p)
    }
  }

  if (block.tagName === 'TABLE') {
    // margin: 0 auto 12pt → убрать лишний низ
    const ml = block.style.marginLeft
    const mr = block.style.marginRight
    stripCssProps(block, ['margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'])
    block.style.marginTop = lh <= 1.15 ? '0' : '4pt'
    block.style.marginBottom = lh <= 1.15 ? '4pt' : '8pt'
    if (ml === 'auto' || mr === 'auto') {
      block.style.marginLeft = 'auto'
      block.style.marginRight = 'auto'
    }
  }

  // line-height в конце — после stripCssProps, который может переписать style
  block.style.lineHeight = lineHeight
  syncMceInlineStyle(block)
}

/** Удаляет свойства и из CSSOM, и из атрибута style (shorthand иначе остаётся). */
function stripCssProps(el: HTMLElement, props: string[]) {
  for (const prop of props) {
    el.style.removeProperty(prop)
  }
  let style = el.getAttribute('style') || ''
  if (!style) {
    return
  }
  for (const prop of props) {
    const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    style = style.replace(new RegExp(`(?:^|;)\\s*${escaped}\\s*:[^;]*`, 'gi'), '')
  }
  style = style
    .replace(/;;+/g, ';')
    .replace(/^\s*;\s*|\s*;\s*$/g, '')
    .trim()
  if (style) {
    el.setAttribute('style', style)
  } else {
    el.removeAttribute('style')
  }
}

function paragraphBeforeMargin(lh: number): string {
  if (lh <= 1) return '0'
  if (lh <= 1.15) return '4pt'
  if (lh <= 1.5) return '6pt'
  return '8pt'
}

function paragraphAfterMargin(lh: number): string {
  if (lh <= 1) return '0'
  if (lh <= 1.15) return '2pt'
  if (lh <= 1.5) return '4pt'
  return '6pt'
}

function openCustomLineHeightDialog(editor: TinyMCEEditor, current: string) {
  editor.windowManager.open({
    title: 'Межстрочный интервал',
    body: {
      type: 'panel',
      items: [
        {
          type: 'htmlpanel',
          html: '<p style="margin:0 0 8px;font:13px/1.4 system-ui,sans-serif;color:#475569;">Применится ко всему документу. Отступы ячеек таблиц не меняются.</p>',
        },
        {
          type: 'input',
          name: 'value',
          label: 'Интервал',
          inputMode: 'decimal',
          placeholder: '1',
        },
      ],
    },
    initialData: { value: current ? current.replace('.', ',') : '1' },
    buttons: [
      { type: 'cancel', text: 'Отмена' },
      { type: 'submit', text: 'Применить', buttonType: 'primary' },
    ],
    onSubmit: (api) => {
      const data = api.getData() as { value?: string }
      const normalized = normalizeLineHeight(data.value ?? '')
      if (!normalized) {
        editor.windowManager.alert('Укажите число от 0,5 до 5')
        return
      }
      api.close()
      applyLineHeightToEntireDocument(editor, normalized)
    },
  })
}

function readDocumentLineHeight(editor: TinyMCEEditor): string {
  const body = editor.getBody()
  if (!body) {
    return ''
  }
  if (body.style.lineHeight) {
    return body.style.lineHeight
  }
  const sample = body.querySelector<HTMLElement>('p, td, th')
  return sample?.style.lineHeight || ''
}

/** «1,15» / «150%» / «1.5em» → канонический множитель «1.15». */
export function normalizeLineHeight(raw: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(',', '.')
    .replace(/\s+/g, '')
  if (!cleaned) {
    return ''
  }
  if (cleaned.endsWith('%')) {
    const pct = Number.parseFloat(cleaned)
    if (!Number.isFinite(pct) || pct < 50 || pct > 500) {
      return ''
    }
    return formatMultiplier(pct / 100)
  }
  const num = Number.parseFloat(cleaned)
  if (!Number.isFinite(num) || num < 0.5 || num > 5) {
    return ''
  }
  return formatMultiplier(num)
}

function formatMultiplier(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}
