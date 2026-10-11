import { openPrintWindow } from '@/features/documents/print-documents'

export type CourierRouteSheetRow = {
  orderNumber: string
  deviceLabel: string
  serialNumber: string
  phone: string
  address: string
}

/** Формат телефона как в RO App: +7 (903) 966-13-99 */
export function formatCourierPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  let normalized = digits
  if (normalized.length === 11 && (normalized.startsWith('7') || normalized.startsWith('8'))) {
    normalized = normalized.slice(1)
  }
  if (normalized.length === 10) {
    return `+7 (${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6, 8)}-${normalized.slice(8)}`
  }
  return value.trim()
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildCourierRouteSheetHtml(rows: CourierRouteSheetRow[]) {
  const bodyRows = rows
    .map((row, index) => {
      const addressHtml = escapeHtml(row.address).replace(/\n/g, '<br>')
      return `<tr>
        <td class="col-n">${index + 1}</td>
        <td class="col-order">${escapeHtml(row.orderNumber)}</td>
        <td class="col-device">${escapeHtml(row.deviceLabel)}</td>
        <td class="col-serial">${escapeHtml(row.serialNumber)}</td>
        <td class="col-phone">${escapeHtml(row.phone)}</td>
        <td class="col-address">${addressHtml}</td>
        <td class="col-time"></td>
        <td class="col-sign"></td>
        <td class="col-note"></td>
      </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Маршрутный лист курьера</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 10mm;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      line-height: 1.25;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1 {
      margin: 0 0 14px;
      text-align: center;
      font-size: 20px;
      font-weight: 700;
    }
    .courier-line {
      margin: 0 0 14px;
      font-size: 13px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid #000;
      padding: 5px 4px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    th {
      text-align: center;
      font-weight: 700;
      font-size: 11px;
    }
    td { font-size: 11px; }
    .col-n { width: 4%; text-align: center; }
    .col-order { width: 7%; }
    .col-device { width: 18%; }
    .col-serial { width: 12%; }
    .col-phone { width: 13%; }
    .col-address { width: 22%; }
    .col-time { width: 7%; }
    .col-sign { width: 9%; }
    .col-note { width: 8%; }
  </style>
</head>
<body>
  <h1>Маршрутный лист курьера</h1>
  <p class="courier-line">Курьер: ___________________________________</p>
  <table>
    <thead>
      <tr>
        <th class="col-n">№</th>
        <th class="col-order">Заказ</th>
        <th class="col-device">Устройство</th>
        <th class="col-serial">Серийный номер</th>
        <th class="col-phone">Номер телефона</th>
        <th class="col-address">Адрес</th>
        <th class="col-time">Время</th>
        <th class="col-sign">Подпись клиента</th>
        <th class="col-note">Примечание</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
  <script>
    (function () {
      var printed = false;
      function runPrint() {
        if (printed) return;
        printed = true;
        window.focus();
        window.print();
      }
      window.addEventListener('afterprint', function () {
        window.close();
      });
      if (document.readyState === 'complete') {
        setTimeout(runPrint, 50);
      } else {
        window.addEventListener('load', function () { setTimeout(runPrint, 50); });
      }
    })();
  <\/script>
</body>
</html>`
}

export async function printCourierRouteSheet(rows: CourierRouteSheetRow[]) {
  if (rows.length === 0) {
    throw new Error('Нет заказов для печати списка.')
  }
  const popup = openPrintWindow()
  if (!popup) {
    throw new Error('Разрешите всплывающие окна, чтобы напечатать список заказов.')
  }
  popup.document.open()
  popup.document.write(buildCourierRouteSheetHtml(rows))
  popup.document.close()
  try {
    popup.focus()
  } catch {
    // ignore
  }
}
