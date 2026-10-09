import html2canvas from 'html2canvas-pro'
import { jsPDF } from 'jspdf'

import { DOCUMENT_HTML_BODY_STYLE, documentMarginsPadding } from './document-content-style'
import { renderFilledDocumentHtml, templateHtml } from './html-template'
import {
  templatePageMargins,
  type DocumentContext,
  type PageMarginsMm,
  type TemplateBlock,
} from './template-schema'

export type PrintableDocument = {
  title?: string
  body: TemplateBlock[]
  context: DocumentContext
  pageSize: 'a4' | 'label'
}

const MAX_PDF_PAGES = 40

function buildPrintStyles(pageSize: 'a4' | 'label', margins: PageMarginsMm) {
  // Chrome скрывает «Масштаб» / ориентацию, если задан @page { size: A4|… }.
  // Для обычных документов — size: auto, масштаб выбирает пользователь в диалоге.
  // Этикетки оставляем фиксированными (термопринтер).
  const pageMargin = `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`
  const pageRule =
    pageSize === 'label'
      ? `@page { size: 58mm 40mm; margin: ${pageMargin}; }`
      : `@page { size: auto; margin: ${pageMargin}; }`

  return `
    ${pageRule}
    html {
      margin: 0;
      padding: 0;
    }
    body {
      margin: 0;
      padding: 0;
      width: auto;
      max-width: 100%;
      box-sizing: border-box;
      background: white;
      color: #000;
      overflow-x: visible;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .document-document,
    .document-html-body {
      margin: 0;
      padding: 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: visible;
    }
    .document-html-body table {
      width: 100% !important;
      max-width: 100% !important;
      table-layout: fixed !important;
      border-collapse: collapse !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      box-sizing: border-box !important;
      break-inside: auto;
      page-break-inside: auto;
    }
    .document-html-body td,
    .document-html-body th {
      overflow: hidden !important;
      word-break: break-word !important;
      overflow-wrap: break-word !important;
      -webkit-hyphens: auto;
      hyphens: auto;
      white-space: normal !important;
      box-sizing: border-box !important;
    }
    /* Поля документа: сохранить Enter / пробелы / отступы (перебивает white-space ячейки). */
    .document-html-body .doc-field {
      white-space: pre-wrap !important;
    }
    .document-html-body img {
      max-width: 100% !important;
      height: auto !important;
    }
    .document-html-body svg:not(.doc-barcode-svg) {
      max-width: 100% !important;
      height: auto !important;
    }
    .document-html-body .doc-barcode-svg,
    .document-html-body svg.doc-barcode-svg {
      display: inline-block !important;
      height: 3rem !important;
      max-width: 100% !important;
      width: auto !important;
      vertical-align: middle;
    }
    .document-html-body tr {
      break-inside: auto;
      page-break-inside: auto;
    }
    .document-document + .document-document {
      break-before: page;
      page-break-before: always;
    }
    a[href]::after { content: none !important; }
    ${DOCUMENT_HTML_BODY_STYLE}
  `
}

async function buildFilledMarkup(document: PrintableDocument) {
  const raw = await renderFilledDocumentHtml(templateHtml(document.body), document.context)
  return stripPrintHostileCss(raw)
}

export function openPrintWindow() {
  const popup = window.open('about:blank', '_blank')
  if (!popup) {
    return null
  }
  popup.document.open()
  popup.document.write(
    '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title></title></head><body><p style="font-family:Arial,sans-serif;padding:24px;">Подготовка документа…</p></body></html>',
  )
  popup.document.close()
  return popup
}

/**
 * Обычная печать через HTML-окно (без PDF).
 * Диалог печати вызываем скриптом внутри окна — после await из opener
 * браузеры часто блокируют popup.print().
 */
export async function printDocumentsInWindow(popup: Window, documents: PrintableDocument[]) {
  if (documents.length === 0) {
    popup.close()
    return
  }

  const primary = documents[0]!
  const margins = templatePageMargins(primary.body, primary.pageSize)
  const styles = buildPrintStyles(primary.pageSize, margins)

  const bodies = await Promise.all(
    documents.map(async (document) => {
      const markup = await buildFilledMarkup(document)
      return `<div class="document-document"><div class="document-html-body">${markup}</div></div>`
    }),
  )

  popup.document.open()
  popup.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>&nbsp;</title>
  <style>${styles}</style>
</head>
<body>
  ${bodies.join('')}
  <script>
    (function () {
      var printed = false;
      function whenImagesReady(done) {
        var imgs = Array.prototype.slice.call(document.images || []);
        var pending = imgs.filter(function (img) { return !img.complete; });
        if (!pending.length) { done(); return; }
        var left = pending.length;
        var finish = function () {
          left -= 1;
          if (left <= 0) done();
        };
        pending.forEach(function (img) {
          img.addEventListener('load', finish, { once: true });
          img.addEventListener('error', finish, { once: true });
        });
        setTimeout(done, 4000);
      }
      function triggerPrint() {
        if (printed) return;
        printed = true;
        try { window.focus(); } catch (e) {}
        // Масштаб — только в системном диалоге (Scale / «Вписать в страницу»).
        try { window.print(); } catch (e) {}
      }
      function start() {
        whenImagesReady(function () {
          setTimeout(triggerPrint, 200);
        });
      }
      if (document.readyState === 'complete') start();
      else window.addEventListener('load', start);
      window.addEventListener('afterprint', function () {
        try { window.close(); } catch (e) {}
      });
    })();
  <\/script>
</body>
</html>`)
  popup.document.close()
  try {
    popup.focus()
  } catch {
    // ignore
  }
}

/** Печать одного шаблона/документа — HTML, без конвертации в PDF. */
export async function printDocumentSheets(input: PrintableDocument) {
  const popup = openPrintWindow()
  if (!popup) {
    throw new Error('Разрешите всплывающие окна для печати')
  }
  await printDocumentsInWindow(popup, [input])
}

/** Скачать PDF. */
export async function downloadDocumentPdf(input: PrintableDocument) {
  const pdf = await buildDocumentsPdf([input])
  pdf.save(`${sanitizeFilename(input.title || 'Документ')}.pdf`)
}

async function buildDocumentsPdf(documents: PrintableDocument[]) {
  const primary = documents[0]!
  const primaryLabel = primary.pageSize === 'label'
  const primaryW = primaryLabel ? 58 : 210
  const primaryH = primaryLabel ? 40 : 297

  const pdf = new jsPDF({
    unit: 'mm',
    format: primaryLabel ? [primaryW, primaryH] : 'a4',
    orientation: primaryW >= primaryH ? 'landscape' : 'portrait',
    compress: true,
  })

  let isFirstSlice = true
  for (const document of documents) {
    const isLabel = document.pageSize === 'label'
    const pageWmm = isLabel ? 58 : 210
    const pageHmm = isLabel ? 40 : 297
    const canvas = await renderDocumentCanvas(document)
    if (!canvas.width || !canvas.height) {
      throw new Error('Не удалось отрисовать документ для PDF')
    }

    const imgW = pageWmm
    const imgH = (canvas.height * pageWmm) / canvas.width
    if (!Number.isFinite(imgH) || imgH <= 0) {
      throw new Error('Некорректный размер страницы PDF')
    }

    const pageData = canvas.toDataURL('image/jpeg', 0.92)
    let heightLeft = imgH
    let offsetY = 0
    let pages = 0

    while (pages < MAX_PDF_PAGES) {
      if (!isFirstSlice) {
        pdf.addPage(
          isLabel ? [pageWmm, pageHmm] : 'a4',
          pageWmm >= pageHmm ? 'landscape' : 'portrait',
        )
      }
      isFirstSlice = false
      pages += 1
      pdf.addImage(pageData, 'JPEG', 0, offsetY, imgW, imgH, undefined, 'FAST')
      heightLeft -= pageHmm
      if (heightLeft <= 0.5) {
        break
      }
      offsetY = heightLeft - imgH
    }
  }

  return pdf
}

async function renderDocumentCanvas(input: PrintableDocument) {
  const margins = templatePageMargins(input.body, input.pageSize)
  const pad = documentMarginsPadding(margins)
  const markup = await buildFilledMarkup(input)
  const isLabel = input.pageSize === 'label'
  const pageWmm = isLabel ? 58 : 210
  const pxPerMm = 96 / 25.4
  const pageWpx = Math.round(pageWmm * pxPerMm)

  const host = document.createElement('div')
  host.setAttribute('data-pdf-export', '1')
  host.style.cssText = [
    'position:fixed',
    'left:-12000px',
    'top:0',
    `width:${pageWpx}px`,
    'background:#fff',
    'color:#000',
    'z-index:-1',
    'pointer-events:none',
  ].join(';')

  host.innerHTML = `
    <style>
      [data-pdf-export] {
        font-family: 'Times New Roman', Times, serif;
        font-size: 12pt;
        line-height: 1.15;
        box-sizing: border-box;
      }
      [data-pdf-export], [data-pdf-export] * { box-sizing: border-box; }
      [data-pdf-export] .pdf-page-shell {
        width: ${pageWmm}mm;
        max-width: 100%;
        padding: ${pad};
        background: #fff;
        color: #000;
      }
      ${DOCUMENT_HTML_BODY_STYLE}
      [data-pdf-export] .document-html-body { margin: 0; padding: 0; width: 100%; }
      [data-pdf-export] a[href]::after { content: none !important; }
      [data-pdf-export] .doc-field {
        background: transparent !important;
        white-space: pre-wrap !important;
      }
    </style>
    <div class="pdf-page-shell">
      <div class="document-html-body">${markup}</div>
    </div>
  `
  document.body.appendChild(host)

  try {
    prepareImagesForCapture(host)
    await withTimeout(waitForImages(host), 8000)
    await withTimeout(waitForFonts(document), 2000)
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

    const target = host.querySelector('.pdf-page-shell')
    if (!(target instanceof HTMLElement)) {
      throw new Error('Не найден контейнер документа')
    }
    return await withTimeout(
      html2canvas(target, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: pageWpx,
        imageTimeout: 5000,
        onclone: (_doc, cloned) => {
          cloned.style.color = '#000'
          cloned.style.backgroundColor = '#fff'
          for (const field of cloned.querySelectorAll('.doc-field')) {
            if (field instanceof HTMLElement) {
              field.style.background = 'transparent'
              field.style.backgroundColor = 'transparent'
            }
          }
        },
      }),
      45000,
      'Таймаут отрисовки PDF',
    )
  } finally {
    host.remove()
  }
}

function prepareImagesForCapture(root: ParentNode) {
  for (const image of root.querySelectorAll('img')) {
    try {
      if (!image.getAttribute('crossorigin')) {
        const src = image.currentSrc || image.src
        if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
          image.setAttribute('crossorigin', 'anonymous')
          image.src = src
        }
      }
    } catch {
      // ignore
    }
  }
}

function sanitizeFilename(value: string) {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 120) || 'Документ'
}

function stripPrintHostileCss(html: string) {
  return html
    .replace(/\s*page-break-[a-z-]+\s*:\s*[^;"]+;?/gi, '')
    .replace(/\s*break-[a-z-]+\s*:\s*[^;"]+;?/gi, '')
    .replace(/\s*height\s*:\s*\d+(\.\d+)?mm\s*;?/gi, (match) => {
      const value = Number.parseFloat(match.replace(/[^\d.]/g, ''))
      return value >= 200 ? '' : match
    })
}

function waitForImages(root: ParentNode | Document) {
  const images =
    root instanceof Document
      ? [...root.images]
      : [...root.querySelectorAll('img')]
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
          const done = () => resolve()
          image.addEventListener('load', done, { once: true })
          image.addEventListener('error', done, { once: true })
          window.setTimeout(done, 5000)
        }),
    ),
  ).then(() => undefined)
}

async function waitForFonts(doc: Document) {
  try {
    const fonts = doc.fonts
    if (fonts?.ready) {
      await fonts.ready
    }
  } catch {
    // ignore
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Таймаут'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}
