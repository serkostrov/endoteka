import { renderFilledDocumentHtml, templateHtml } from './html-template'
import type { DocumentContext, TemplateBlock } from './template-schema'

export type PrintableDocument = {
  title?: string
  body: TemplateBlock[]
  context: DocumentContext
  pageSize: 'a4' | 'label'
}

const PRINT_STYLES = `
  @page { size: A4; margin: 12mm; }
  html, body {
    margin: 0;
    background: white;
    color: #111;
  }
  .document-sheet {
    box-sizing: border-box;
    background: white;
    color: #111;
  }
  .document-sheet-a4 {
    width: auto;
    min-height: auto;
    padding: 0;
  }
  .document-sheet-label {
    width: 58mm;
    min-height: 40mm;
    padding: 0;
  }
  .document-sheet + .document-sheet {
    break-before: page;
    page-break-before: always;
  }
  .document-html-body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12pt;
    line-height: 1.45;
    color: #111;
  }
  .document-html-body h1 { font-size: 2em; font-weight: 700; margin: 0.67em 0; }
  .document-html-body h2 { font-size: 1.5em; font-weight: 700; margin: 0.75em 0; }
  .document-html-body h3 { font-size: 1.17em; font-weight: 700; margin: 1em 0; }
  .document-html-body p { margin: 0 0 1em; }
  .document-html-body table { width: 100%; border-collapse: collapse; }
  .document-html-body td,
  .document-html-body th {
    border: 1px solid #222;
    padding: 6px 8px;
    vertical-align: middle;
  }
  .document-html-body img { display: inline-block; max-width: 100%; height: auto; }
  .document-html-body .doc-qr-image {
    display: inline-block;
    width: 4.5rem;
    height: 4.5rem;
    vertical-align: middle;
  }
  .document-html-body .doc-barcode-svg,
  .document-html-body svg.doc-barcode-svg {
    display: inline-block;
    height: 3rem;
    max-width: 16rem;
    vertical-align: middle;
  }
`

export function openPrintWindow() {
  const popup = window.open('', '_blank')
  if (!popup) {
    return null
  }
  popup.document.open()
  popup.document.write(
    '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Печать</title></head><body><p style="font-family:Arial,sans-serif;padding:24px;">Подготовка документа…</p></body></html>',
  )
  popup.document.close()
  return popup
}

export async function printDocumentsInWindow(popup: Window, documents: PrintableDocument[]) {
  const sheets = await Promise.all(
    documents.map(async (document) => {
      const markup = await renderFilledDocumentHtml(templateHtml(document.body), document.context)
      const sheetClass = document.pageSize === 'label' ? 'document-sheet-label' : 'document-sheet-a4'
      return `<section class="document-sheet ${sheetClass}"><div class="document-html-body">${markup}</div></section>`
    }),
  )

  const title = documents.length === 1 ? documents[0]?.title || 'Печать' : 'Печать'
  popup.document.open()
  popup.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  ${sheets.join('')}
</body>
</html>`)
  popup.document.close()

  await waitForImages(popup.document)
  popup.focus()
  popup.print()
  popup.addEventListener('afterprint', () => {
    popup.close()
  })
}

function waitForImages(doc: Document) {
  const images = [...doc.images]
  if (images.length === 0) {
    return Promise.resolve()
  }
  return Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve()
            return
          }
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        }),
    ),
  ).then(() => undefined)
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
