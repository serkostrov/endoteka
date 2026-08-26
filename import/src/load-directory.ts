import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DATASET_FILES, DATASET_ORDER, type DatasetId, type CsvRow } from './types.ts'
import { parseCsv } from './csv.ts'

export async function loadDatasetDirectory(directory: string): Promise<Partial<Record<DatasetId, CsvRow[]>>> {
  const rows: Partial<Record<DatasetId, CsvRow[]>> = {}
  for (const dataset of DATASET_ORDER) {
    const filePath = path.join(directory, DATASET_FILES[dataset])
    try {
      const text = await readFile(filePath, 'utf8')
      rows[dataset] = parseCsv(text).rows
    } catch (error) {
      if (isNotFound(error)) {
        continue
      }
      throw error
    }
  }
  return rows
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
