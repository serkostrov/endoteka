import type { Editor as TinyMCEEditor } from 'tinymce'

import { notifyEditorContentChanged } from './notify-editor-change'
import { ownTableCells, setCellPadding as writeCellPadding, clearFixedTableHeights } from './table-cell-padding'

type TablePropsData = {
  width: string
  height: string
  showBorder: boolean
  borderWidth: string
  borderColor: string
  padY: string
  padX: string
  align: string
  caption: boolean
  backgroundColor: string
}

const ALIGN_ITEMS = [
  { text: 'Без выравнивания', value: '' },
  { text: 'Слева', value: 'left' },
  { text: 'По центру', value: 'center' },
  { text: 'Справа', value: 'right' },
]

/**
 * Заменяет стандартный диалог TinyMCE: свойства реально пишутся в HTML/CSS
 * (атрибут border, padding/рамки ячеек), в духе Word / документов.
 */
export function registerTablePropsDialog(editor: TinyMCEEditor) {
  const open = () => openTablePropsDialog(editor)
  editor.addCommand('mceTableProps', open)
  // Плагин table регистрирует команду после setup — перехватываем на init.
  editor.on('init', () => {
    editor.addCommand('mceTableProps', open)
  })
}

export function openTablePropsDialog(editor: TinyMCEEditor) {
  const table = findSelectedTable(editor)
  if (!table) {
    return
  }

  const initial = readTableProps(editor, table)

  editor.windowManager.open({
    title: 'Свойства таблицы',
    size: 'normal',
    body: {
      type: 'panel',
      items: [
        {
          type: 'grid',
          columns: 2,
          items: [
            {
              type: 'input',
              name: 'width',
              label: 'Ширина',
              placeholder: '100% или 500',
            },
            {
              type: 'input',
              name: 'height',
              label: 'Высота',
              placeholder: 'необязательно',
            },
          ],
        },
        {
          type: 'listbox',
          name: 'align',
          label: 'Выравнивание на странице',
          items: ALIGN_ITEMS,
        },
        {
          type: 'htmlpanel',
          html: '<p style="margin:14px 0 2px;font:600 12px/1.2 system-ui,sans-serif;color:#334155;">Рамки</p>',
        },
        {
          type: 'grid',
          columns: 2,
          items: [
            {
              type: 'checkbox',
              name: 'showBorder',
              label: 'Показать рамки',
            },
            {
              type: 'input',
              name: 'borderWidth',
              label: 'Толщина (pt)',
              inputMode: 'decimal',
              placeholder: '1',
            },
          ],
        },
        {
          type: 'grid',
          columns: 2,
          items: [
            {
              type: 'colorinput',
              name: 'borderColor',
              label: 'Цвет рамки',
            },
            {
              type: 'colorinput',
              name: 'backgroundColor',
              label: 'Фон таблицы',
            },
          ],
        },
        {
          type: 'htmlpanel',
          html: '<p style="margin:14px 0 2px;font:600 12px/1.2 system-ui,sans-serif;color:#334155;">Отступы ячеек</p>',
        },
        {
          type: 'grid',
          columns: 2,
          items: [
            {
              type: 'input',
              name: 'padY',
              label: 'Сверху / снизу (pt)',
              inputMode: 'decimal',
              placeholder: '4',
            },
            {
              type: 'input',
              name: 'padX',
              label: 'Слева / справа (pt)',
              inputMode: 'decimal',
              placeholder: '6',
            },
          ],
        },
        {
          type: 'checkbox',
          name: 'caption',
          label: 'Показать подпись таблицы',
        },
      ],
    },
    initialData: initial,
    buttons: [
      { type: 'cancel', text: 'Отменить' },
      { type: 'submit', text: 'Сохранить', buttonType: 'primary' },
    ],
    onSubmit: (api) => {
      const data = api.getData() as TablePropsData
      api.close()
      editor.undoManager.transact(() => {
        applyTableProps(editor, table, initial, data)
        editor.focus()
        editor.dispatch('TableModified', { table, structure: data.caption !== initial.caption, style: true })
      })
      notifyEditorContentChanged(editor)
    },
  })
}

function findSelectedTable(editor: TinyMCEEditor): HTMLTableElement | null {
  const node = editor.selection.getNode()
  const cell = editor.dom.getParent(node, 'td,th,caption') as HTMLElement | null
  if (cell) {
    return editor.dom.getParent(cell, 'table') as HTMLTableElement | null
  }
  return editor.dom.getParent(node, 'table') as HTMLTableElement | null
}

function readTableProps(editor: TinyMCEEditor, table: HTMLTableElement): TablePropsData {
  const dom = editor.dom
  const cells = ownTableCells(table)
  const borderAttr = dom.getAttrib(table, 'border')
  const hasBorderAttr = borderAttr !== '' && borderAttr !== '0'
  const sampleBorder = cells.map((c) => rawStyle(c, 'border-width') || rawStyle(c, 'border')).find(Boolean) ?? ''
  const borderNoneCount = cells.filter((c) => {
    const b = (rawStyle(c, 'border') || '').toLowerCase()
    return b === 'none' || b === '0' || rawStyle(c, 'border-width') === '0'
  }).length
  const showBorder = hasBorderAttr || (cells.length > 0 && borderNoneCount < cells.length / 2)

  const paddings = cells.map((c) => readCellPadding(c)).filter(Boolean)
  const sharedPad = sharedValue(paddings)
  const { y: padY, x: padX } = parsePadding(sharedPad)

  const borderWidths = cells
    .map((c) => normalizeSize(rawStyle(c, 'border-width') || ''))
    .filter((v) => v && v !== '0')
  const borderColors = cells
    .map((c) => toHexColor(rawStyle(c, 'border-color') || ''))
    .filter(Boolean)

  let borderWidth = sharedValue(borderWidths)
  if (!borderWidth && sampleBorder && sampleBorder !== 'none') {
    borderWidth = normalizeSize(sampleBorder)
  }
  if (!borderWidth && showBorder) {
    borderWidth = '1'
  }

  return {
    width: dom.getStyle(table, 'width') || dom.getAttrib(table, 'width') || '',
    height: dom.getStyle(table, 'height') || dom.getAttrib(table, 'height') || '',
    showBorder,
    borderWidth: stripUnit(borderWidth),
    borderColor: sharedValue(borderColors) || toHexColor(rawStyle(table, 'border-color')) || '#000000',
    padY,
    padX,
    align: readAlign(editor, table),
    caption: Boolean(table.querySelector('caption')),
    backgroundColor: toHexColor(rawStyle(table, 'background-color') || dom.getStyle(table, 'background-color') || '') || '',
  }
}

function applyTableProps(
  editor: TinyMCEEditor,
  table: HTMLTableElement,
  prev: TablePropsData,
  next: TablePropsData,
) {
  const dom = editor.dom
  const cells = ownTableCells(table)

  // Размер
  const width = normalizeCssSize(next.width.trim())
  if (width) {
    dom.setStyle(table, 'width', width)
    dom.setAttrib(table, 'width', null)
  } else {
    dom.setStyle(table, 'width', null)
    dom.setAttrib(table, 'width', null)
  }

  const height = normalizeCssSize(next.height.trim())
  if (height) {
    dom.setStyle(table, 'height', height)
  } else {
    dom.setStyle(table, 'height', null)
  }

  dom.setStyle(table, 'border-collapse', 'collapse')

  // Фон
  const bg = next.backgroundColor?.trim() || ''
  if (bg) {
    dom.setStyle(table, 'background-color', bg)
  } else {
    dom.setStyle(table, 'background-color', null)
  }

  // Рамки — через атрибут border (наш CSS) + inline на ячейках
  const borderOn = Boolean(next.showBorder)
  const borderW = stripUnit(next.borderWidth) || '1'
  const borderColor = next.borderColor?.trim() || '#000000'
  const borderWidthCss = `${borderW}pt`

  if (borderOn) {
    dom.setAttrib(table, 'border', '1')
    dom.setStyle(table, 'border-width', null)
    dom.setStyle(table, 'border-color', borderColor)
    for (const cell of cells) {
      // Сбрасываем border:none из макетных шаблонов
      const current = (rawStyle(cell, 'border') || '').toLowerCase()
      if (current === 'none' || current === '0') {
        dom.setStyle(cell, 'border', null)
      }
      dom.setStyle(cell, 'border-width', borderWidthCss)
      dom.setStyle(cell, 'border-style', 'solid')
      dom.setStyle(cell, 'border-color', borderColor)
    }
  } else {
    dom.setAttrib(table, 'border', '0')
    dom.setStyle(table, 'border-width', null)
    dom.setStyle(table, 'border-color', null)
    for (const cell of cells) {
      dom.setStyle(cell, 'border-width', null)
      dom.setStyle(cell, 'border-style', null)
      dom.setStyle(cell, 'border-color', null)
      dom.setStyle(cell, 'border', 'none')
    }
  }

  // Отступы ячеек — явные longhands + shorthand, чтобы top/bottom не терялись
  const padY = stripUnit(next.padY)
  const padX = stripUnit(next.padX)
  if (padY !== '' || padX !== '') {
    const y = padY === '' ? '0' : padY
    const x = padX === '' ? y : padX
    // Сначала снять фиксированные высоты строк — иначе при padding:0 «пустота» остаётся
    clearFixedTableHeights(table)
    for (const cell of cells) {
      writeCellPadding(cell, y, x)
    }
    clearFixedTableHeights(table)
  }

  // Выравнивание
  if (next.align !== prev.align) {
    setTableAlign(editor, table, next.align)
  }

  // Подпись
  if (next.caption !== prev.caption) {
    editor.execCommand('mceTableToggleCaption')
  }

  // Убрать устаревшие HTML-атрибуты, которые конфликтуют с CSS
  dom.setAttrib(table, 'cellpadding', null)
  dom.setAttrib(table, 'cellspacing', null)
}

function setTableAlign(editor: TinyMCEEditor, table: HTMLTableElement, align: string) {
  for (const name of ['left', 'center', 'right']) {
    if (name !== align) {
      editor.formatter.remove(`align${name}`, {}, table)
    }
  }
  if (align) {
    editor.formatter.apply(`align${align}`, {}, table)
  } else {
    // Чистим margin от прошлых выравниваний, сохраняя вертикальные отступы
    const dom = editor.dom
    const margin = rawStyle(table, 'margin') || ''
    const bottom = margin.match(/(\d+(?:\.\d+)?(?:pt|px|em|mm)?)\s*$/)?.[1]
    dom.setStyle(table, 'margin-left', null)
    dom.setStyle(table, 'margin-right', null)
    dom.setStyle(table, 'float', null)
    if (margin.includes('auto') || /margin-left|margin-right/.test(table.getAttribute('style') || '')) {
      const mb = rawStyle(table, 'margin-bottom') || bottom || ''
      const mt = rawStyle(table, 'margin-top') || ''
      if (mt || mb) {
        dom.setStyle(table, 'margin', `${mt || '0'} 0 ${mb || '0'} 0`)
      } else {
        dom.setStyle(table, 'margin', null)
      }
    }
  }
}

function readAlign(editor: TinyMCEEditor, table: HTMLTableElement): string {
  for (const name of ['left', 'center', 'right'] as const) {
    if (editor.formatter.matchNode(table, `align${name}`)) {
      return name
    }
  }
  const ml = (rawStyle(table, 'margin-left') || editor.dom.getStyle(table, 'margin-left') || '').toLowerCase()
  const mr = (rawStyle(table, 'margin-right') || editor.dom.getStyle(table, 'margin-right') || '').toLowerCase()
  const margin = (rawStyle(table, 'margin') || '').toLowerCase()
  if ((ml === 'auto' && mr === 'auto') || /^(?:\S+\s+){1}auto\s+auto/.test(margin) || margin.includes('auto')) {
    if (ml === 'auto' && mr === 'auto') return 'center'
    if (margin.split(/\s+/).filter((p) => p === 'auto').length >= 2) return 'center'
  }
  if (ml === 'auto' && mr !== 'auto') return 'right'
  if (mr === 'auto' && ml !== 'auto') return 'left'
  const float = (rawStyle(table, 'float') || '').toLowerCase()
  if (float === 'left' || float === 'right') return float
  return ''
}

function rawStyle(el: HTMLElement, prop: string): string {
  // Только inline — не путаем с CSS редактора (padding: 3px 6px и т.п.)
  const style = el.getAttribute('style')
  if (!style) return ''
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`, 'i')
  const match = style.match(re)
  return match?.[1]?.trim() ?? ''
}

function sharedValue(values: string[]): string {
  const first = values[0]
  if (first == null) return ''
  return values.every((v) => v === first) ? first : ''
}

function readCellPadding(el: HTMLElement): string {
  const shorthand = rawStyle(el, 'padding')
  if (shorthand) {
    return shorthand
  }
  const top = rawStyle(el, 'padding-top') || el.style.paddingTop
  const right = rawStyle(el, 'padding-right') || el.style.paddingRight
  const bottom = rawStyle(el, 'padding-bottom') || el.style.paddingBottom
  const left = rawStyle(el, 'padding-left') || el.style.paddingLeft
  if (!top && !right && !bottom && !left) {
    return ''
  }
  // Сводим к двум значениям Y X (берём top/right; bottom/left для асимметрии усредняем к ним)
  const y = top || bottom || '0'
  const x = right || left || y
  return `${y} ${x}`
}

function parsePadding(value: string): { y: string; x: string } {
  if (!value.trim()) return { y: '', x: '' }
  const parts = value.trim().split(/\s+/)
  if (parts.length === 1) {
    const n = stripUnit(parts[0] ?? '')
    return { y: n, x: n }
  }
  if (parts.length === 2) {
    return { y: stripUnit(parts[0] ?? ''), x: stripUnit(parts[1] ?? '') }
  }
  if (parts.length === 3) {
    // top | horizontal | bottom → Y = top (или avg с bottom), X = horizontal
    return { y: stripUnit(parts[0] ?? ''), x: stripUnit(parts[1] ?? '') }
  }
  // top right bottom left
  return { y: stripUnit(parts[0] ?? ''), x: stripUnit(parts[1] ?? '') }
}

function stripUnit(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/px|pt|em|rem|mm|cm|%/gi, '')
    .trim()
}

function normalizeSize(value: string): string {
  const v = value.trim()
  if (!v || v === 'none') return ''
  // "1px solid rgb(...)" → берём первое значение
  const first = v.split(/\s+/)[0] ?? ''
  return stripUnit(first)
}

/** Число без единицы → px; проценты и pt оставляем. */
function normalizeCssSize(value: string): string {
  if (!value) return ''
  if (/^\d+(\.\d+)?$/.test(value)) return `${value}px`
  return value
}

function toHexColor(value: string): string {
  const v = value.trim()
  if (!v || v === 'transparent' || v === 'inherit' || v === 'currentcolor') return ''
  if (v.startsWith('#')) {
    if (v.length === 4) {
      const r = v[1] ?? '0'
      const g = v[2] ?? '0'
      const b = v[3] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
    return v.toLowerCase()
  }
  const rgb = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgb?.[1] != null && rgb[2] != null && rgb[3] != null) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
    return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`
  }
  return v
}
