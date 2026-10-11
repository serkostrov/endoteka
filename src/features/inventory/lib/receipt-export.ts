import ExcelJS from 'exceljs'
import { format } from 'date-fns'

import { downloadBlob } from '@/lib/download-blob'

export { downloadBlob }

export const RECEIPT_EXPORT_HEADERS = [
  'Оприходование №',
  'Дата создания',
  'Создал',
  'Дата изменения',
  'Обновил',
  'Поставщик',
  'Накладная №',
  'Склад',
  'Категория',
  'Внутренний код',
  'Артикул',
  'Штрихкод',
  'Наименование',
  'Гарантия поставщика',
  'Гарантийный период',
  'Годен до',
  'Серийный номер',
  'Количество',
  'Единица измерения',
  'Цена, ₽',
  'Сумма, ₽',
  'Налоги, ₽',
] as const

/** Ширины колонок как в выгрузке RO App (символы). */
const COLUMN_WIDTHS = [16, 22, 18, 16, 16, 28, 14, 16, 18, 16, 16, 14, 48, 16, 16, 12, 14, 12, 16, 12, 12, 12]

export type ReceiptExportLine = {
  receiptNumber: string
  createdAt: string
  createdByName: string
  updatedAt: string | null
  updatedByName: string
  supplier: string
  invoiceNumber: string
  warehouseName: string
  categoryName: string
  itemCode: string
  itemArticle: string
  itemBarcode: string
  itemName: string
  supplierWarranty: number
  warrantyPeriod: string
  expiresAt: string
  serialNumber: string
  quantity: number
  unitCode: string
  unitPrice: number
  lineAmount: number
  taxAmount: number
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return format(date, 'yyyy-MM-dd HH:mm:ss')
}

export async function buildReceiptExportWorkbook(lines: ReceiptExportLine[]): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Endoteka'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('List 1', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  sheet.columns = RECEIPT_EXPORT_HEADERS.map((header, index) => ({
    header,
    key: `c${index}`,
    width: COLUMN_WIDTHS[index] ?? 14,
  }))

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: 'middle', wrapText: true }
  headerRow.height = 22

  for (const line of lines) {
    sheet.addRow([
      line.receiptNumber,
      formatDateTime(line.createdAt),
      line.createdByName,
      formatDateTime(line.updatedAt),
      line.updatedByName,
      line.supplier,
      line.invoiceNumber,
      line.warehouseName,
      line.categoryName,
      line.itemCode,
      line.itemArticle,
      line.itemBarcode,
      line.itemName,
      line.supplierWarranty,
      line.warrantyPeriod,
      line.expiresAt,
      line.serialNumber,
      line.quantity,
      line.unitCode,
      line.unitPrice,
      line.lineAmount,
      line.taxAmount,
    ])
  }

  // Числовые колонки: гарантия, кол-во, цена, сумма, налоги
  for (let rowIndex = 2; rowIndex <= lines.length + 1; rowIndex += 1) {
    const row = sheet.getRow(rowIndex)
    for (const col of [14, 18, 20, 21, 22]) {
      const cell = row.getCell(col)
      if (typeof cell.value === 'number') {
        cell.numFmt = col === 18 ? '0' : '0.00'
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function receiptExportFilename(now = new Date()) {
  return `Оприходованные товары ${format(now, 'yyyy-MM-dd')}.xlsx`
}
