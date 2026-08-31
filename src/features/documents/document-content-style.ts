/** Shared document CSS for the TinyMCE iframe (`body`) and `.document-html-body` preview. */
export const DOCUMENT_CONTENT_STYLE = `
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12pt;
    line-height: 1.45;
    margin: 16px 20px 32px;
    color: #111;
  }
  h1 { font-size: 2em; font-weight: 700; margin: 0.67em 0; }
  h2 { font-size: 1.5em; font-weight: 700; margin: 0.75em 0; }
  h3 { font-size: 1.17em; font-weight: 700; margin: 1em 0; }
  h4, h5, h6 { font-size: 1em; font-weight: 700; margin: 1.33em 0; }
  p { margin: 0 0 1em; }
  ul, ol { margin: 1em 0; padding-inline-start: 40px; list-style: revert; }
  hr { border: none; border-top: 1px solid #ccc; margin: 1em 0; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px dotted #94a3b8; padding: 6px 8px; vertical-align: middle; }
  img { max-width: 100%; height: auto; }
  .doc-field {
    background: #e8f0fe;
    color: #1d4ed8;
    padding: 0 0.35em;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.92em;
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
