import QRCode from 'qrcode'

import { openPrintWindow } from '@/features/documents/print-documents'
import {
  isBarcodeType,
  labelPayload,
  renderLinearBarcode,
  type BarcodeType,
} from '@/lib/constants/barcode'

/** Физический размер этикетки (как page_size=label в документах). */
const LABEL_W_MM = 58
const LABEL_H_MM = 40
/** Внутренние поля — чтобы текст/штрихкод не обрезались принтером. */
const PAD_MM = 2.5

export type PrintableItemLabel = {
  name: string
  code: string
  barcode: string
  barcodeType: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function buildBarcodeMarkup(type: BarcodeType, payload: string) {
  if (!payload) {
    return `<p class="label-empty">Нет значения</p>`
  }

  if (type === 'qr') {
    const url = await QRCode.toDataURL(payload, {
      margin: 1,
      width: 256,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
    return `<img class="label-qr" src="${url}" alt="${escapeHtml(payload)}" />`
  }

  const rendered = renderLinearBarcode(type, payload)
  if (rendered.kind === 'error') {
    return `<p class="label-empty">${escapeHtml(rendered.message)}</p>`
  }

  return `
    <svg class="label-bars" role="img" aria-label="${escapeHtml(rendered.payload)}" viewBox="0 0 ${rendered.width} ${rendered.height}" preserveAspectRatio="none">
      <path d="${rendered.d}" stroke="#000" stroke-width="1" fill="none"></path>
    </svg>
    <p class="label-payload">${escapeHtml(rendered.payload)}</p>
  `
}

async function buildLabelHtml(item: PrintableItemLabel) {
  const type: BarcodeType = isBarcodeType(item.barcodeType) ? item.barcodeType : 'code128'
  const payload = labelPayload(item.barcode, item.code)
  const barcode = await buildBarcodeMarkup(type, payload)
  const title = escapeHtml(item.name.trim() || item.code || '—')

  return `
    <section class="label-sheet">
      <p class="label-title">${title}</p>
      <div class="label-barcode">${barcode}</div>
    </section>
  `
}

function buildStyles() {
  return `
    @page {
      size: ${LABEL_W_MM}mm ${LABEL_H_MM}mm;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      width: ${LABEL_W_MM}mm;
    }
    .label-sheet {
      box-sizing: border-box;
      width: ${LABEL_W_MM}mm;
      height: ${LABEL_H_MM}mm;
      padding: ${PAD_MM}mm;
      margin: 0;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
    }
    .label-sheet:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .label-title {
      margin: 0;
      padding: 0;
      flex: 0 0 auto;
      max-height: 9mm;
      overflow: hidden;
      text-align: center;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8.5pt;
      font-weight: 600;
      line-height: 1.15;
      word-break: break-word;
    }
    .label-barcode {
      flex: 1 1 auto;
      min-height: 0;
      margin-top: 1.2mm;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: center;
      overflow: hidden;
    }
    .label-bars {
      display: block;
      width: 100%;
      height: 18mm;
      max-height: 100%;
    }
    .label-payload {
      margin: 1mm 0 0;
      padding: 0;
      flex: 0 0 auto;
      text-align: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 7.5pt;
      line-height: 1;
      letter-spacing: 0.02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .label-qr {
      display: block;
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 22mm;
      margin: 0 auto;
      object-fit: contain;
    }
    .label-empty {
      margin: 0;
      text-align: center;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8pt;
      color: #666;
    }
  `
}

/**
 * Печать этикеток в том же виде, что предпросмотр на карточке позиции
 * (название сверху, штрихкод по центру, значение под ним).
 */
export async function printItemLabels(items: PrintableItemLabel[]) {
  if (items.length === 0) {
    return
  }

  const popup = openPrintWindow()
  if (!popup) {
    throw new Error('Разрешите всплывающие окна для печати')
  }

  try {
    const sheets = await Promise.all(items.map((item) => buildLabelHtml(item)))
    popup.document.open()
    popup.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${LABEL_W_MM}mm, initial-scale=1">
  <title>Этикетки</title>
  <style>${buildStyles()}</style>
</head>
<body>
  ${sheets.join('')}
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
  } catch (error) {
    popup.close()
    throw error
  }
}
