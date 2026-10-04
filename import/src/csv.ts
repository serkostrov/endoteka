import type { CsvRow } from './types.ts'

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}

/** Split CSV text into physical records, keeping newlines inside quoted fields. */
function splitCsvRecords(text: string): string[] {
  const records: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      current += char
      if (inQuotes && text[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1
      }
      if (current.trim() !== '') {
        records.push(current)
      }
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') {
    records.push(current)
  }
  return records
}

export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const records = splitCsvRecords(text.replace(/^\uFEFF/, ''))
  const headerLine = records[0]
  if (!headerLine) {
    return { headers: [], rows: [] }
  }

  const headers = splitCsvLine(headerLine).map((header) => header.trim())
  const rows = records.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? '').trim()
    })
    return row
  })

  return { headers, rows }
}

export function canonHeader(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е').replace(/[\s-]+/g, '_')
}

export function mapRow(row: CsvRow, aliases: Record<string, string>): CsvRow {
  const mapped: CsvRow = {}
  for (const [header, value] of Object.entries(row)) {
    const field = aliases[canonHeader(header)]
    if (field) {
      mapped[field] = value
    }
  }
  return mapped
}

export function pick(row: CsvRow, field: string): string {
  return (row[field] ?? '').trim()
}
