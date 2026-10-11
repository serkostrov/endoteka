import ExcelJS from 'exceljs'
import { format } from 'date-fns'

import { downloadBlob } from '@/lib/download-blob'

export { downloadBlob }

export const STOCK_EXPORT_HEADERS = [
  'Внутренний код',
  'Артикул',
  'Код производителя',
  'Штрихкод',
  'Наименование',
  'Категория',
  'Описание',
  'Остаток',
  'Заказано',
  'Единица измерения',
  'Годен до',
  'Серийные номера',
  'Нулевая',
  'Ремонтная',
  'Розничная',
] as const

/** Ширины колонок как в выгрузке RO App (символы). */
const COLUMN_WIDTHS = [32, 31, 16, 16, 63, 17, 61, 16, 16, 16, 16, 16, 16, 16, 16]

export type StockExportLine = {
  itemCode: string
  itemArticle: string
  manufacturerCode: string
  itemBarcode: string
  itemName: string
  categoryName: string
  description: string
  stockQuantity: number
  orderedQuantity: number
  unitCode: string
  expiresAt: string
  serialNumbers: string
  purchasePrice: number
  repairPrice: number
  retailPrice: number
}

export async function buildStockExportWorkbook(lines: StockExportLine[]): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Endoteka'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('List 1', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  sheet.columns = STOCK_EXPORT_HEADERS.map((header, index) => ({
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
      line.itemCode,
      line.itemArticle,
      line.manufacturerCode,
      line.itemBarcode,
      line.itemName,
      line.categoryName,
      line.description,
      line.stockQuantity,
      line.orderedQuantity,
      line.unitCode,
      line.expiresAt,
      line.serialNumbers,
      line.purchasePrice,
      line.repairPrice,
      line.retailPrice,
    ])
  }

  // Числовые: остаток, заказано, нулевая/ремонтная/розничная
  for (let rowIndex = 2; rowIndex <= lines.length + 1; rowIndex += 1) {
    const row = sheet.getRow(rowIndex)
    for (const col of [8, 9, 13, 14, 15]) {
      const cell = row.getCell(col)
      if (typeof cell.value === 'number') {
        cell.numFmt = col === 8 || col === 9 ? '0' : '0.00'
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function stockExportFilename(now = new Date()) {
  return `Остатки на складе ${format(now, 'yyyy-MM-dd')}.xlsx`
}
