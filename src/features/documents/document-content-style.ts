import type { PageMarginsMm } from './template-schema'
import { DEFAULT_LABEL_MARGINS_MM, DEFAULT_PAGE_MARGINS_MM } from './template-schema'

/** Shared CSS for TinyMCE iframe, on-screen preview, and print. */

const DOCUMENT_BASE_STYLE = `
  html, body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    line-height: 1.15;
    margin: 0;
    color: #000;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: inherit;
    font-weight: 700;
    margin: 0.35em 0 0.25em;
    line-height: 1.2;
  }
  h1 { font-size: 1.75em; }
  h2 { font-size: 1.35em; }
  h3 { font-size: 1.15em; }
  p {
    margin: 0 0 0.15em;
    font-family: inherit;
  }
  ul, ol {
    margin: 0.35em 0;
    padding-inline-start: 40px;
    list-style: revert;
  }
  hr {
    border: none;
    border-top: 1px solid #000;
    margin: 0.4em 0;
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    max-width: 100%;
    table-layout: fixed;
    font-family: inherit;
  }
  td, th {
    padding: 0;
    vertical-align: middle;
    font-family: inherit;
    line-height: 1.15;
    overflow-wrap: anywhere;
    word-wrap: break-word;
    word-break: break-word;
  }
  /*
   * TinyMCE оборачивает ячейки в <p>. Любой margin/padding у них
   * выглядит как «отступы полей», даже когда у td padding: 0.
   */
  td > p, th > p,
  td > p:first-child, th > p:first-child,
  td > p:last-child, th > p:last-child {
    margin: 0;
    padding: 0;
    line-height: inherit;
  }
  td > p + p, th > p + p {
    margin-top: 0;
  }
  td .doc-field, th .doc-field {
    padding: 0;
    line-height: inherit;
    vertical-align: baseline;
  }
  /*
   * Рамки только у таблиц с border≠0 (как Word / RoApp).
   * Longhand — чтобы inline border-width / border-color из «Свойств таблицы» реально работали.
   */
  table[border]:not([border="0"]) td,
  table[border]:not([border="0"]) th {
    border-width: 1px;
    border-style: solid;
    border-color: #000;
  }
  img {
    max-width: 100%;
    height: auto;
  }
  .doc-field {
    background: rgba(59, 130, 246, 0.14);
    border-radius: 2px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    font-style: inherit;
    color: inherit;
    text-decoration: inherit;
    line-height: inherit;
  }
  .doc-qr, .doc-barcode {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 4.5rem;
    padding: 0.4rem 0.6rem;
    border: 1px dashed #64748b;
    color: #475569;
    font-size: 11px;
  }
`

/** Редактор без фиксированного листа (fallback). */
export const DOCUMENT_CONTENT_STYLE = `
  ${DOCUMENT_BASE_STYLE}
  html, body { background: #fff; }
  body { margin: 12mm 14mm 16mm; }
`

type EditorPageSize = 'a4' | 'label'

function paddingCss(margins: PageMarginsMm) {
  return `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`
}

/**
 * Стили холста редактора: серый фон; белые листы рисуются JS-слоем с зазорами.
 * Отступы — поля страницы (как колонтитулы).
 */
export function documentEditorContentStyle(
  pageSize: EditorPageSize = 'a4',
  margins?: PageMarginsMm,
) {
  const m = margins ?? (pageSize === 'label' ? DEFAULT_LABEL_MARGINS_MM : DEFAULT_PAGE_MARGINS_MM)

  if (pageSize === 'label') {
    return `
      ${DOCUMENT_BASE_STYLE}
      html {
        background: #c5cad3;
        min-height: 100%;
      }
      body {
        position: relative;
        z-index: 1;
        box-sizing: border-box;
        width: 58mm;
        min-height: 40mm;
        margin: 24px auto 48px;
        padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
        background: transparent;
        border: none;
        box-shadow: none;
      }
      [data-doc-page-gap] {
        display: block;
        margin: 0;
        padding: 0;
        border: 0;
        line-height: 0;
        font-size: 0;
        user-select: none;
        cursor: default;
        -webkit-user-modify: read-only;
      }
      [data-doc-page-gap] * {
        user-select: none;
        pointer-events: none;
      }
    `
  }

  return `
    ${DOCUMENT_BASE_STYLE}
    html {
      background: #c5cad3;
      min-height: 100%;
    }
    body {
      position: relative;
      z-index: 1;
      box-sizing: border-box;
      width: 210mm;
      min-height: 297mm;
      margin: 24px auto 56px;
      padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
      background: transparent;
      border: none;
      box-shadow: none;
    }
    [data-doc-page-gap] {
      display: block;
      margin: 0;
      padding: 0;
      border: 0;
      line-height: 0;
      font-size: 0;
      user-select: none;
      cursor: default;
      -webkit-user-modify: read-only;
    }
    [data-doc-page-gap] * {
      user-select: none;
      pointer-events: none;
    }
  `
}

/** CSS padding shorthand for preview/print sheets. */
export function documentMarginsPadding(margins: PageMarginsMm) {
  return paddingCss(margins)
}

/** Preview/print body styles (same rules, scoped under .document-html-body). */
export const DOCUMENT_HTML_BODY_STYLE = `
  .document-html-body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    line-height: 1.15;
    color: #000;
  }
  .document-html-body h1 { font-size: 1.75em; font-weight: 700; margin: 0.35em 0 0.25em; line-height: 1.2; }
  .document-html-body h2 { font-size: 1.35em; font-weight: 700; margin: 0.35em 0 0.25em; line-height: 1.2; }
  .document-html-body h3 { font-size: 1.15em; font-weight: 700; margin: 0.35em 0 0.25em; line-height: 1.2; }
  .document-html-body h4,
  .document-html-body h5,
  .document-html-body h6 { font-size: 1em; font-weight: 700; margin: 0.35em 0 0.25em; line-height: 1.2; }
  .document-html-body p { margin: 0 0 0.15em; }
  .document-html-body ul,
  .document-html-body ol {
    margin: 0.35em 0;
    padding-inline-start: 40px;
    list-style: revert;
  }
  .document-html-body hr {
    margin: 0.4em 0;
    border: none;
    border-top: 1px solid #000;
  }
  .document-html-body,
  .document-html-body * {
    box-sizing: border-box;
  }
  .document-html-body table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .document-html-body td,
  .document-html-body th {
    padding: 0;
    vertical-align: middle;
    border: none;
    line-height: 1.15;
    overflow-wrap: anywhere;
    word-wrap: break-word;
    word-break: break-word;
  }
  .document-html-body td > p,
  .document-html-body th > p {
    margin: 0;
    padding: 0;
    line-height: inherit;
  }
  .document-html-body table[border]:not([border="0"]) td,
  .document-html-body table[border]:not([border="0"]) th {
    border-width: 1px;
    border-style: solid;
    border-color: #000;
  }
  .document-html-body img {
    display: inline-block;
    max-width: 100%;
    height: auto;
  }
  .document-html-body .doc-field {
    background: none;
    color: inherit;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    border-radius: 0;
    line-height: inherit;
  }
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
