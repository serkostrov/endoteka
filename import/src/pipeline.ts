import { HEADER_ALIASES } from './catalog.ts'
import { mapRow, parseCsv } from './csv.ts'
import { handlers } from './handlers.ts'
import { formatReportText, summarize, writeReportFiles } from './report.ts'
import type { ImportStore } from './store.ts'
import {
  DATASET_FILES,
  DATASET_ORDER,
  DatasetId,
  ImportPhase,
  type CsvRow,
  type DatasetId as DatasetIdType,
  type ImportReport,
  type RowOutcome,
} from './types.ts'

export type DatasetRows = Partial<Record<DatasetIdType, CsvRow[]>>

export type RunImportInput = {
  store: ImportStore
  phase: ImportPhase
  rows: DatasetRows
  dryRun?: boolean
  sourceDir?: string
  abortAfter?: number
  retryFromRunId?: string
  outDir?: string
}

export class ImportAbortedError extends Error {
  constructor() {
    super('Импорт прерван.')
    this.name = 'ImportAbortedError'
  }
}

export async function runImport(input: RunImportInput): Promise<ImportReport> {
  const dryRun = input.dryRun === true
  const run = await input.store.startRun({
    phase: input.phase,
    dryRun,
    sourceDir: input.sourceDir ?? '',
  })
  const startedAt = new Date().toISOString()
  const outcomes: RowOutcome[] = []
  let applied = 0

  try {
    if (input.retryFromRunId) {
      const failed = await input.store.listFailedRows(input.retryFromRunId)
      for (const row of failed) {
        const handler = handlers[row.dataset]
        const mapped = mapRow(row.payload, HEADER_ALIASES[row.dataset])
        const source = Object.keys(mapped).length > 0 ? mapped : row.payload
        const outcome = await handler({ store: input.store, runId: run.id, dryRun }, source, row.rowNumber)
        outcomes.push(outcome)
        await input.store.recordRow(run.id, outcome)
        if (outcome.status !== 'failed') {
          applied += 1
          if (input.abortAfter !== undefined && applied >= input.abortAfter) {
            throw new ImportAbortedError()
          }
        }
      }
    } else {
      for (const dataset of DATASET_ORDER) {
        const datasetRows = input.rows[dataset] ?? []
        for (const [index, raw] of datasetRows.entries()) {
          const mapped = mapRow(raw, HEADER_ALIASES[dataset])
          const outcome = await handlers[dataset](
            { store: input.store, runId: run.id, dryRun },
            mapped,
            index + 2,
          )
          outcomes.push(outcome)
          await input.store.recordRow(run.id, outcome)
          if (outcome.status !== 'failed') {
            applied += 1
            if (input.abortAfter !== undefined && applied >= input.abortAfter) {
              throw new ImportAbortedError()
            }
          }
        }
      }
    }

    const { totals, byDataset } = summarize(outcomes)
    const status = dryRun ? 'preview' : 'completed'
    await input.store.finishRun(run.id, status, totals)
    const report: ImportReport = {
      runId: run.id,
      phase: input.phase,
      dryRun,
      status,
      totals,
      byDataset,
      rows: outcomes,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    if (input.outDir) {
      await writeReportFiles(input.outDir, report)
    }
    return report
  } catch (error) {
    const interrupted = error instanceof ImportAbortedError
    const { totals, byDataset } = summarize(outcomes)
    await input.store.finishRun(
      run.id,
      interrupted ? 'interrupted' : 'failed',
      totals,
      error instanceof Error ? error.message : 'Ошибка импорта.',
    )
    const report: ImportReport = {
      runId: run.id,
      phase: input.phase,
      dryRun,
      status: interrupted ? 'interrupted' : 'failed',
      totals,
      byDataset,
      rows: outcomes,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    if (input.outDir) {
      await writeReportFiles(input.outDir, report)
    }
    if (!interrupted) {
      throw error
    }
    return report
  }
}

export function parseDatasetFile(text: string): CsvRow[] {
  return parseCsv(text).rows
}

export { DATASET_FILES, DATASET_ORDER, DatasetId, ImportPhase, formatReportText }
