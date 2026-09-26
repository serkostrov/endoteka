import { useMemo, useRef } from 'react'
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

import { DOCUMENT_CONTENT_STYLE } from '../document-content-style'
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

void tinymce

type TinyMceDocumentEditorProps = {
  value: string
  onChange: (html: string) => void
  disabled?: boolean
  settingsFields?: PlaceholderDefinition[]
}

export function TinyMceDocumentEditor({
  value,
  onChange,
  disabled = false,
  settingsFields = [],
}: TinyMceDocumentEditorProps) {
  const settingsRef = useRef(settingsFields)
  settingsRef.current = settingsFields
  const init = useMemo(() => createInit(() => settingsRef.current), [])

  return (
    <div className="document-tinymce flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      <Editor
        licenseKey="gpl"
        value={value}
        disabled={disabled}
        onEditorChange={onChange}
        init={init}
      />
    </div>
  )
}

function createInit(getSettingsFields: () => PlaceholderDefinition[]): Record<string, unknown> {
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
      'undo redo | fontfamily fontsize | forecolor backcolor | bold italic underline strikethrough | alignleft aligncenter alignright alignjustify | bullist numlist | table image hr | placeholders tablefields logo qrcode barcode | code fullscreen',
    font_family_formats:
      'Sans-Serif=Arial,Helvetica,sans-serif; Serif=Times New Roman,Times,serif; Narrow=Arial Narrow,sans-serif; Consolas=Consolas,monospace',
    font_size_formats: '8pt 10pt 11pt 12pt 14pt 18pt 24pt 36pt',
    toolbar_mode: 'sliding',
    skin_url: 'default',
    content_css: false,
    convert_urls: false,
    relative_urls: false,
    content_style: DOCUMENT_CONTENT_STYLE,
    image_title: true,
    automatic_uploads: false,
    table_default_styles: { width: '100%', 'border-collapse': 'collapse' },
    table_default_attributes: { border: '1' },
    format_noneditable_selector: 'span.doc-field',
    extended_valid_elements:
      'span[class|contenteditable|data-code|data-field|data-date-format|data-mce-cef-wrappable|style]',
    setup: (editor: TinyMCEEditor) => {
      registerExtras(editor, getSettingsFields)
      const refreshPreviews = () => hydrateFieldPreviews(editor, getSettingsFields())
      editor.on('SetContent', refreshPreviews)
      editor.on('init', refreshPreviews)
    },
  }
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
    `<span class="doc-field" data-field="${escapeAttr(key)}"${formatAttr} data-mce-cef-wrappable="true" contenteditable="false">${preview}</span>&nbsp;`,
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
    el.setAttribute('contenteditable', 'false')
    el.setAttribute('data-mce-cef-wrappable', 'true')
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
