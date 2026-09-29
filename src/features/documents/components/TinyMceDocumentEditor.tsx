import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import tinymce from 'tinymce'
import { Editor } from '@tinymce/tinymce-react'
import type { Editor as TinyMCEEditor } from 'tinymce'

import 'tinymce/icons/default/icons.min.js'
import 'tinymce/themes/silver/theme.min.js'
import 'tinymce/models/dom/model.min.js'
import 'tinymce/skins/ui/oxide/skin.js'
import 'tinymce/plugins/code/plugin.min.js'
import 'tinymce/plugins/fullscreen/plugin.min.js'
import 'tinymce/plugins/image/plugin.min.js'
import 'tinymce/plugins/link/plugin.min.js'
import 'tinymce/plugins/lists/plugin.min.js'
import 'tinymce/plugins/preview/plugin.min.js'
import 'tinymce/plugins/searchreplace/plugin.min.js'
import 'tinymce/plugins/table/plugin.min.js'
import 'tinymce/skins/ui/oxide/content.js'
import 'tinymce/skins/content/default/content.js'

import { DocumentPageSize, type DocumentPageSize as PageSize } from '@/lib/constants/documents'
import { cn } from '@/lib/utils'

import { documentEditorContentStyle } from '../document-content-style'
import { DEFAULT_DOCUMENT_DATE_FORMAT, documentDateFormats } from '../date-formats'
import { resolvePlaceholderValue } from '../interpolate'
import {
  groupPlaceholders,
  mergePlaceholderCatalog,
  placeholdersForContext,
  SAMPLE_PLACEHOLDER_VALUES,
  placeholderRegistry,
  type PlaceholderDefinition,
} from '../placeholders'
import { registerTablePropsDialog } from '../table-props-dialog'
import { registerLineHeightControl } from '../line-height-control'
import { registerBlockSpacingControl } from '../block-spacing-control'
import { registerDocFieldGuards, unlockDocFieldsForSelection } from '../doc-field-editing'
import { normalizePageMargins, type PageMarginsMm } from '../template-schema'

void tinymce

type TinyMceDocumentEditorProps = {
  value: string
  onChange: (html: string) => void
  disabled?: boolean
  settingsFields?: PlaceholderDefinition[]
  /** Формат листа: редактор показывает страницу в реальных размерах. */
  pageSize?: PageSize
  /** Поля страницы (отступы), мм. */
  margins?: PageMarginsMm
  /** Актуальный инстанс TinyMCE — для getContent() при сохранении. */
  editorRef?: MutableRefObject<TinyMCEEditor | null>
}

export function TinyMceDocumentEditor({
  value,
  onChange,
  disabled = false,
  settingsFields = [],
  pageSize = DocumentPageSize.A4,
  margins,
  editorRef,
}: TinyMceDocumentEditorProps) {
  const settingsRef = useRef(settingsFields)
  settingsRef.current = settingsFields
  const resolvedMargins = useMemo(
    () =>
      normalizePageMargins(
        margins,
        pageSize === DocumentPageSize.Label ? 'label' : 'a4',
      ),
    [margins, pageSize],
  )
  const marginsRef = useRef(resolvedMargins)
  marginsRef.current = resolvedMargins
  const localEditorRef = useRef<TinyMCEEditor | null>(null)

  const init = useMemo(
    () => createInit(() => settingsRef.current, pageSize, () => marginsRef.current),
    [pageSize],
  )

  // Поля страницы меняются без remount — обновляем направляющие листа.
  useEffect(() => {
    const editor = localEditorRef.current
    if (!editor) {
      return
    }
    try {
      syncPageGuides(editor, pageSize, marginsRef.current)
    } catch {
      // редактор ещё не готов / уже снят
    }
  }, [pageSize, resolvedMargins])

  useEffect(() => {
    return () => {
      localEditorRef.current = null
      if (editorRef) {
        editorRef.current = null
      }
    }
  }, [editorRef])

  function bindEditor(editor: TinyMCEEditor) {
    localEditorRef.current = editor
    if (editorRef) {
      editorRef.current = editor
    }
  }

  return (
    <div
      className={cn(
        'document-tinymce document-tinymce--paged flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card',
        pageSize === DocumentPageSize.Label && 'document-tinymce--label',
      )}
    >
      <Editor
        key={pageSize}
        licenseKey="gpl"
        value={value}
        disabled={disabled}
        onEditorChange={onChange}
        onInit={(_event, editor) => bindEditor(editor)}
        init={init}
      />
    </div>
  )
}

function createInit(
  getSettingsFields: () => PlaceholderDefinition[],
  pageSize: PageSize,
  getMargins: () => PageMarginsMm,
): Record<string, unknown> {
  const size = pageSize === DocumentPageSize.Label ? 'label' : 'a4'
  const margins = getMargins()
  return {
    language: 'ru',
    language_url: '/tinymce/langs/ru.js',
    menubar: false,
    branding: false,
    promotion: false,
    statusbar: true,
    resize: false,
    height: '100%',
    min_height: 240,
    plugins: 'table image lists link code fullscreen preview searchreplace',
    toolbar:
      'undo redo | fontfamily fontsize doclineheight blockspacing | forecolor backcolor | bold italic underline strikethrough | alignleft aligncenter alignright alignjustify | bullist numlist | table image hr | placeholders tablefields logo qrcode barcode | code fullscreen',
    font_family_formats:
      'Sans-Serif=Arial,Helvetica,sans-serif; Serif=Times New Roman,Times,serif; Narrow=Arial Narrow,sans-serif; Consolas=Consolas,monospace',
    font_size_formats: '8pt 10pt 11pt 12pt 14pt 18pt 24pt 36pt',
    line_height_formats: '1 1.15 1.5 2 2.5 3',
    toolbar_mode: 'sliding',
    contextmenu: 'blockspacing table image link',
    skin_url: 'default',
    content_css: false,
    convert_urls: false,
    relative_urls: false,
    content_style: documentEditorContentStyle(size, margins),
    image_title: true,
    automatic_uploads: false,
    table_default_styles: {
      width: '100%',
      'border-collapse': 'collapse',
    },
    table_default_attributes: { border: '1' },
    table_style_by_css: true,
    table_advtab: false,
    table_appearance_options: false,
    format_noneditable_selector: 'div[data-doc-page-gap]',
    noneditable_class: 'mceNonEditable',
    extended_valid_elements:
      'span[class|contenteditable|data-code|data-field|data-date-format|data-mce-cef-wrappable|style]',
    setup: (editor: TinyMCEEditor) => {
      registerTablePropsDialog(editor)
      registerLineHeightControl(editor)
      registerBlockSpacingControl(editor)
      registerDocFieldGuards(editor)
      registerExtras(editor, getSettingsFields)
      registerPageGapGuards(editor)
      const refreshPreviews = () => hydrateFieldPreviews(editor, getSettingsFields())
      const refreshPages = () => syncPageGuides(editor, pageSize, getMargins())
      let pageTimer: number | undefined
      const schedulePages = () => {
        window.clearTimeout(pageTimer)
        pageTimer = window.setTimeout(refreshPages, 120)
      }
      editor.on('SetContent', () => {
        refreshPreviews()
        refreshPages()
      })
      editor.on('BeforeGetContent', () => {
        const body = editor.getBody()
        if (body) {
          unlockDocFieldsForSelection(body)
        }
      })
      editor.on('init', () => {
        refreshPreviews()
        refreshPages()
      })
      editor.on('NodeChange Input ResizeEditor keyup change', schedulePages)
      editor.on('remove', () => {
        window.clearTimeout(pageTimer)
      })
    },
  }
}

const PAGE_CANVAS_BG = '#c5cad3'

/**
 * Отдельные листы с зазорами (как Word).
 * Разрыв — непрозрачный spacer в потоке (не оверлей): в нём нельзя писать.
 * Промежутки data-mce-bogus в HTML шаблона не попадают.
 */
function syncPageGuides(editor: TinyMCEEditor, pageSize: PageSize, margins: PageMarginsMm) {
  const doc = editor.getDoc()
  const body = editor.getBody()
  if (!doc || !body) {
    return
  }

  const isLabel = pageSize === DocumentPageSize.Label
  const pageMm = isLabel ? 40 : 297
  const gapMm = isLabel ? 10 : 18
  const pageWmm = isLabel ? 58 : 210
  const formatLabel = isLabel ? 'Этикетка 58×40 мм' : 'A4 · 210×297 мм'

  const root = doc.documentElement
  root.style.position = 'relative'

  // Убрать старые топорные оверлеи, если остались
  doc.getElementById('endoteka-page-gap-covers')?.remove()

  let layer = doc.getElementById('endoteka-page-guides')
  if (!layer) {
    layer = doc.createElement('div')
    layer.id = 'endoteka-page-guides'
    layer.setAttribute('contenteditable', 'false')
    layer.setAttribute('data-mce-bogus', 'all')
    layer.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;z-index:0;overflow:visible;'
    root.insertBefore(layer, doc.body)
  }

  const pageH = mmToPx(doc, pageMm)
  const visualGapH = mmToPx(doc, gapMm)
  const padTop = mmToPx(doc, margins.top)
  const padBottom = mmToPx(doc, margins.bottom)
  const usableH = Math.max(48, pageH - padTop - padBottom)
  const flowGapH = padBottom + visualGapH + padTop

  body.style.padding = `${margins.top}mm ${margins.right}mm 0 ${margins.left}mm`
  clearBodyMask(body)

  const bookmark = editor.selection.getBookmark(2, true)
  clearPageGaps(body)
  body.style.minHeight = `${pageH}px`
  body.style.paddingBottom = `${margins.bottom}mm`
  void body.offsetHeight

  let pageCount = 1
  const maxPages = 40
  let stuck = 0
  while (pageCount < maxPages) {
    const boundary = pageCount * usableH + (pageCount - 1) * flowGapH
    if (!contentExtendsPast(body, boundary)) {
      break
    }
    const heightBefore = body.scrollHeight
    body.style.paddingBottom = '0'
    insertPageGapAtBoundary(doc, body, boundary, {
      padBottom,
      visualGapH,
      padTop,
      usableH,
    })
    body.style.paddingBottom = `${margins.bottom}mm`
    pageCount += 1
    void body.offsetHeight
    if (body.scrollHeight < heightBefore + flowGapH * 0.25) {
      stuck += 1
      if (stuck > 2) {
        break
      }
    } else {
      stuck = 0
    }
  }

  const finalPages = pageCount
  const finalGaps = finalPages - 1
  const totalH = finalPages * pageH + finalGaps * visualGapH
  body.style.minHeight = `${totalH}px`
  void body.offsetHeight

  try {
    editor.selection.moveToBookmark(bookmark)
  } catch {
    // ignore
  }
  ejectCaretFromPageGap(editor)

  const bodyTop = body.offsetTop
  const parts: string[] = []

  for (let i = 0; i < finalPages; i += 1) {
    const top = bodyTop + i * (pageH + visualGapH)
    parts.push(
      `<div style="position:absolute;top:${top}px;left:50%;transform:translateX(-50%);width:${pageWmm}mm;height:${pageH}px;background:#fff;border:1px solid #9aa3b2;border-radius:1px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 10px 28px rgba(0,0,0,.12);pointer-events:none;"></div>`,
    )
    parts.push(
      `<div style="position:absolute;top:${top + 10}px;left:50%;transform:translateX(-50%);width:${pageWmm}mm;pointer-events:none;">
        <span style="float:right;margin-right:10px;font:500 10px/1 system-ui,sans-serif;color:#5b6472;background:${PAGE_CANVAS_BG};padding:3px 8px;border-radius:999px;">Стр. ${i + 1}</span>
      </div>`,
    )
  }

  const footerTop = bodyTop + totalH + 12
  parts.push(
    `<div style="position:absolute;top:${footerTop}px;left:50%;transform:translateX(-50%);font:500 10px/1 system-ui,sans-serif;color:#5b6472;white-space:nowrap;pointer-events:none;">${formatLabel}</div>`,
  )

  layer.style.height = `${footerTop + 36}px`
  layer.innerHTML = parts.join('')
}

/** Не даём каретке и вводу оказаться в межстраничном разрыве. */
function registerPageGapGuards(editor: TinyMCEEditor) {
  const bounce = () => ejectCaretFromPageGap(editor)

  editor.on('click', (event) => {
    const target = event.target as Node | null
    const gap = findPageGap(target)
    if (!gap) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    placeCaretBesideGap(editor, gap, event.clientY ?? 0)
  })

  editor.on('mousedown', (event) => {
    const gap = findPageGap(event.target as Node | null)
    if (!gap) {
      return
    }
    event.preventDefault()
    placeCaretBesideGap(editor, gap, event.clientY ?? 0)
  })

  editor.on('NodeChange keyup', bounce)

  editor.on('keydown', (event) => {
    const node = editor.selection.getNode()
    const gap = findPageGap(node)
    if (gap) {
      event.preventDefault()
      placeCaretBesideGap(editor, gap, 0)
      return
    }

    // Стрелки / Enter у границы разрыва — перепрыгиваем через него
    const key = event.key
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'ArrowRight' && key !== 'Enter') {
      return
    }
    const rng = editor.selection.getRng()
    if (!rng.collapsed) {
      return
    }
    const block = editor.dom.getParent(rng.startContainer, editor.dom.isBlock) as HTMLElement | null
    if (!block || block.hasAttribute('data-doc-page-gap')) {
      return
    }
    if (key === 'ArrowDown' || key === 'ArrowRight' || key === 'Enter') {
      const next = block.nextElementSibling
      if (next?.hasAttribute('data-doc-page-gap')) {
        const after = next.nextElementSibling as HTMLElement | null
        if (after) {
          event.preventDefault()
          editor.selection.setCursorLocation(after, 0)
        }
      }
    }
    if (key === 'ArrowUp') {
      const prev = block.previousElementSibling
      if (prev?.hasAttribute('data-doc-page-gap')) {
        const before = prev.previousElementSibling as HTMLElement | null
        if (before) {
          event.preventDefault()
          editor.selection.select(before, true)
          editor.selection.collapse(false)
        }
      }
    }
  })

  editor.on('beforeinput', (event) => {
    if (findPageGap(editor.selection.getNode())) {
      event.preventDefault()
      ejectCaretFromPageGap(editor)
    }
  })
}

function findPageGap(node: Node | null): HTMLElement | null {
  if (!node) {
    return null
  }
  if (node instanceof HTMLElement && node.hasAttribute('data-doc-page-gap')) {
    return node
  }
  const el = node instanceof HTMLElement ? node : node.parentElement
  return el?.closest('[data-doc-page-gap]') ?? null
}

function ejectCaretFromPageGap(editor: TinyMCEEditor) {
  const gap = findPageGap(editor.selection.getNode())
  if (!gap) {
    return
  }
  placeCaretBesideGap(editor, gap, 0)
}

function placeCaretBesideGap(editor: TinyMCEEditor, gap: HTMLElement, clientY: number) {
  const rect = gap.getBoundingClientRect()
  const preferAfter = clientY >= rect.top + rect.height / 2
  const after = gap.nextElementSibling as HTMLElement | null
  const before = gap.previousElementSibling as HTMLElement | null
  try {
    if (preferAfter && after) {
      editor.selection.setCursorLocation(after, 0)
      return
    }
    if (before) {
      editor.selection.select(before, true)
      editor.selection.collapse(false)
      return
    }
    if (after) {
      editor.selection.setCursorLocation(after, 0)
    }
  } catch {
    // ignore
  }
}

function clearPageGaps(body: HTMLElement) {
  for (const el of body.querySelectorAll('[data-doc-page-gap]')) {
    el.remove()
  }
}

function contentExtendsPast(body: HTMLElement, y: number) {
  for (const child of body.children) {
    if (child.hasAttribute('data-doc-page-gap')) {
      continue
    }
    const el = child as HTMLElement
    if (el.offsetTop + el.offsetHeight > y + 0.5) {
      return true
    }
  }
  return false
}

function clearBodyMask(body: HTMLElement) {
  body.style.maskImage = ''
  body.style.setProperty('-webkit-mask-image', '')
  body.style.maskSize = ''
  body.style.setProperty('-webkit-mask-size', '')
}

type GapMetrics = {
  padBottom: number
  visualGapH: number
  padTop: number
  usableH: number
}

function insertPageGapAtBoundary(doc: Document, body: HTMLElement, y: number, metrics: GapMetrics) {
  let insertBefore: Element | null = null
  let lastFitted: HTMLElement | null = null

  for (const child of [...body.children]) {
    if (child.hasAttribute('data-doc-page-gap')) {
      continue
    }
    const el = child as HTMLElement
    const top = el.offsetTop
    const bottom = top + el.offsetHeight

    if (bottom <= y + 0.5) {
      lastFitted = el
      continue
    }

    const prev = child.previousElementSibling
    const alreadyHasGapBefore = prev?.hasAttribute('data-doc-page-gap') ?? false

    if (top < y && (el.offsetHeight > metrics.usableH || alreadyHasGapBefore)) {
      // Высокий блок — разрыв после него, без добивки (блок уже ниже границы)
      const gap = createPageGap(doc, metrics, 0)
      if (child.nextElementSibling) {
        body.insertBefore(gap, child.nextElementSibling)
      } else {
        body.appendChild(gap)
      }
      return
    }

    insertBefore = child
    break
  }

  // Добиваем остаток текущей страницы до границы, чтобы верхнее поле
  // следующей страницы совпало с заданным отступом.
  const contentEnd = lastFitted ? lastFitted.offsetTop + lastFitted.offsetHeight : 0
  const fillH = Math.max(0, y - contentEnd)
  const gap = createPageGap(doc, metrics, fillH)
  if (insertBefore) {
    body.insertBefore(gap, insertBefore)
  } else {
    body.appendChild(gap)
  }
}

/**
 * Межстраничный разрыв:
 * добивка до конца страницы + нижнее поле + зазор + верхнее поле следующей.
 * Прозрачный — виден фон холста между листами.
 */
function createPageGap(doc: Document, metrics: GapMetrics, fillH: number) {
  const { padBottom, visualGapH, padTop } = metrics
  const totalH = fillH + padBottom + visualGapH + padTop
  const gap = doc.createElement('div')
  gap.setAttribute('data-doc-page-gap', '1')
  gap.setAttribute('data-mce-bogus', 'all')
  gap.setAttribute('contenteditable', 'false')
  gap.className = 'mceNonEditable doc-page-gap'
  gap.style.cssText = [
    'display:block',
    `height:${totalH}px`,
    'margin:0',
    'padding:0',
    'border:0',
    'line-height:0',
    'font-size:0',
    'user-select:none',
    'cursor:default',
    'overflow:hidden',
    'background:transparent',
    '-webkit-user-modify:read-only',
  ].join(';')

  const fill = doc.createElement('div')
  fill.setAttribute('contenteditable', 'false')
  fill.style.cssText = `height:${fillH}px;margin:0;padding:0;pointer-events:none;background:transparent;`

  const bottomField = doc.createElement('div')
  bottomField.setAttribute('contenteditable', 'false')
  bottomField.style.cssText = `height:${padBottom}px;margin:0;padding:0;pointer-events:none;background:transparent;`

  const gutter = doc.createElement('div')
  gutter.setAttribute('contenteditable', 'false')
  gutter.style.cssText = `height:${visualGapH}px;margin:0;padding:0;pointer-events:none;background:transparent;`

  const topField = doc.createElement('div')
  topField.setAttribute('contenteditable', 'false')
  topField.style.cssText = `height:${padTop}px;margin:0;padding:0;pointer-events:none;background:transparent;`

  gap.append(fill, bottomField, gutter, topField)
  return gap
}

function mmToPx(doc: Document, mm: number) {
  const probe = doc.createElement('div')
  probe.style.cssText = `position:absolute;visibility:hidden;height:${mm}mm;`
  doc.body.appendChild(probe)
  const px = probe.getBoundingClientRect().height
  probe.remove()
  return px || mm * 3.7795
}

function registerExtras(editor: TinyMCEEditor, getSettingsFields: () => PlaceholderDefinition[]) {
  editor.ui.registry.addMenuButton('placeholders', {
    text: 'Поле',
    tooltip: 'Вставить поле документа',
    fetch: (callback) => {
      const items = groupPlaceholders(
        mergePlaceholderCatalog(placeholdersForContext('document'), getSettingsFields()),
      ).flatMap((group) => [
        { type: 'separator' as const },
        {
          type: 'menuitem' as const,
          text: group.name,
          enabled: false,
        },
        ...group.items.map((item) => insertFieldItem(editor, item, getSettingsFields)),
      ])
      callback(items.filter((item, index) => !(item.type === 'separator' && index === 0)))
    },
  })

  editor.ui.registry.addMenuButton('tablefields', {
    text: 'Строка',
    tooltip: 'Поля таблицы запчастей или накладной',
    fetch: (callback) => {
      callback([
        { type: 'menuitem', text: 'Запчасть заказа', enabled: false },
        ...placeholdersForContext('parts')
          .filter((item) => item.scope === 'row')
          .map((item) => insertFieldItem(editor, item, getSettingsFields)),
        { type: 'separator' },
        { type: 'menuitem', text: 'Строка накладной', enabled: false },
        ...placeholdersForContext('lines')
          .filter((item) => item.scope === 'row')
          .map((item) => insertFieldItem(editor, item, getSettingsFields)),
      ])
    },
  })

  editor.ui.registry.addButton('logo', {
    text: 'Логотип',
    icon: 'image',
    tooltip: 'Вставить логотип',
    onAction: () => openUrlDialog(editor, 'Логотип', 'Адрес картинки', (src) => {
      editor.insertContent(
        `<img src="${escapeAttr(src)}" alt="Логотип" style="max-height: 72px; width: auto;">`,
      )
    }),
  })

  editor.ui.registry.addButton('qrcode', {
    text: 'QR',
    tooltip: 'QR-код из поля',
    onAction: () => {
      editor.insertContent('<span class="doc-qr" data-code="{{order.number}}" contenteditable="false">QR {{order.number}}</span>&nbsp;')
    },
  })

  editor.ui.registry.addButton('barcode', {
    text: 'Штрихкод',
    tooltip: 'Штрихкод из поля',
    onAction: () => {
      editor.insertContent('<span class="doc-barcode" data-code="{{item.barcode}}" contenteditable="false">Штрихкод {{item.barcode}}</span>&nbsp;')
    },
  })
}

function insertFieldItem(
  editor: TinyMCEEditor,
  item: PlaceholderDefinition,
  getSettingsFields: () => PlaceholderDefinition[],
) {
  return {
    type: 'menuitem' as const,
    text: item.label,
    onAction: () => {
      if (item.isDate) {
        openDateFormatDialog(editor, item.key, item.label, getSettingsFields)
        return
      }
      insertFieldToken(editor, item.key, undefined, getSettingsFields)
    },
  }
}

function insertFieldToken(
  editor: TinyMCEEditor,
  key: string,
  dateFormat?: string,
  getSettingsFields?: () => PlaceholderDefinition[],
) {
  const formatAttr = dateFormat ? ` data-date-format="${escapeAttr(dateFormat)}"` : ''
  const preview = escapeHtml(fieldPreviewText(key, dateFormat, getSettingsFields?.() ?? []))
  editor.insertContent(
    `<span class="doc-field" data-field="${escapeAttr(key)}"${formatAttr}>${preview}</span>&nbsp;`,
  )
}

function openDateFormatDialog(
  editor: TinyMCEEditor,
  key: string,
  label: string,
  getSettingsFields: () => PlaceholderDefinition[],
) {
  editor.windowManager.open({
    title: `Формат даты — ${label}`,
    body: {
      type: 'panel',
      items: [
        {
          type: 'selectbox',
          name: 'format',
          label: 'Формат',
          size: 1,
          items: documentDateFormats.map((item) => ({ text: item.label, value: item.value })),
        },
      ],
    },
    initialData: { format: DEFAULT_DOCUMENT_DATE_FORMAT },
    buttons: [
      { type: 'cancel', text: 'Отмена' },
      { type: 'submit', text: 'Вставить', buttonType: 'primary' },
    ],
    onSubmit: (api) => {
      const data = api.getData() as { format?: string }
      const format = data.format?.trim() || DEFAULT_DOCUMENT_DATE_FORMAT
      insertFieldToken(editor, key, format, getSettingsFields)
      api.close()
    },
  })
}

function hydrateFieldPreviews(editor: TinyMCEEditor, settingsFields: PlaceholderDefinition[]) {
  const body = editor.getBody()
  if (!body) {
    return
  }
  unlockDocFieldsForSelection(body)
  for (const el of body.querySelectorAll<HTMLElement>('.doc-field')) {
    let key = el.getAttribute('data-field')?.trim() ?? ''
    let dateFormat = el.getAttribute('data-date-format')?.trim() || undefined
    const text = el.textContent?.trim() ?? ''
    if (!key) {
      const match = text.match(/^\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)(?:\|([^}]+))?\s*\}\}$/)
      if (match?.[1]) {
        key = match[1]
        dateFormat = match[2]?.trim() || dateFormat
        el.setAttribute('data-field', key)
        if (dateFormat) {
          el.setAttribute('data-date-format', dateFormat)
        }
      }
    }
    if (!key) {
      continue
    }
    if (!text || /^\{\{/.test(text)) {
      el.textContent = fieldPreviewText(key, dateFormat, settingsFields)
    }
  }
}

function fieldPreviewText(
  key: string,
  dateFormat: string | undefined,
  settingsFields: PlaceholderDefinition[],
) {
  const raw = SAMPLE_PLACEHOLDER_VALUES[key]
  if (raw != null && raw !== '') {
    return resolvePlaceholderValue(key, raw, dateFormat)
  }
  const fromRegistry = key in placeholderRegistry ? placeholderRegistry[key as keyof typeof placeholderRegistry] : null
  const fromSettings = settingsFields.find((item) => item.key === key)
  return fromSettings?.label || fromRegistry?.label || key
}

function openUrlDialog(
  editor: TinyMCEEditor,
  title: string,
  label: string,
  onSubmit: (src: string) => void,
) {
  editor.windowManager.open({
    title,
    body: {
      type: 'panel',
      items: [{ type: 'urlinput', name: 'src', label, filetype: 'image' }],
    },
    buttons: [
      { type: 'cancel', text: 'Отмена' },
      { type: 'submit', text: 'Вставить', buttonType: 'primary' },
    ],
    onSubmit: (api) => {
      const data = api.getData() as { src?: { value?: string } | string }
      const src = typeof data.src === 'string' ? data.src : data.src?.value ?? ''
      if (src.trim()) {
        onSubmit(src.trim())
      }
      api.close()
    },
  })
}

function escapeAttr(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
