import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ImportReport, ImportTotals, RowOutcome } from './types.ts'

export function emptyTotals(): ImportTotals {
  return { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0 }
}

export function addOutcome(totals: ImportTotals, status: RowOutcome['status']): void {
  totals.processed += 1
  totals[status] += 1
}

export function summarize(rows: RowOutcome[]): { totals: ImportTotals; byDataset: Record<string, ImportTotals> } {
  const totals = emptyTotals()
  const byDataset: Record<string, ImportTotals> = {}
  for (const row of rows) {
    addOutcome(totals, row.status)
    const bucket = byDataset[row.dataset] ?? emptyTotals()
    addOutcome(bucket, row.status)
    byDataset[row.dataset] = bucket
  }
  return { totals, byDataset }
}

export function formatReportText(report: ImportReport): string {
  const lines = [
    `Прогон ${report.runId}`,
    `Фаза: ${report.phase}`,
    `Режим: ${report.dryRun ? 'preview' : 'import'}`,
    `Статус: ${report.status}`,
    `processed=${report.totals.processed} created=${report.totals.created} updated=${report.totals.updated} skipped=${report.totals.skipped} failed=${report.totals.failed}`,
  ]
  for (const [dataset, totals] of Object.entries(report.byDataset)) {
    lines.push(
      `  ${dataset}: processed=${totals.processed} created=${totals.created} updated=${totals.updated} skipped=${totals.skipped} failed=${totals.failed}`,
    )
  }
  return lines.join('\n')
}

export function errorsToCsv(rows: RowOutcome[]): string {
  const failed = rows.filter((row) => row.status === 'failed' || row.missingFields.length > 0)
  const header = 'dataset,row_number,status,source_key,error_code,error_message,missing_fields'
  const body = failed.map((row) =>
    [
      row.dataset,
      String(row.rowNumber),
      row.status,
      csvCell(row.sourceKey ?? ''),
      csvCell(row.errorCode ?? ''),
      csvCell(row.errorMessage ?? ''),
      csvCell(row.missingFields.join('|')),
    ].join(','),
  )
  return [header, ...body].join('\n')
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

export async function writeReportFiles(directory: string, report: ImportReport): Promise<{ json: string; errors: string }> {
  const jsonPath = path.join(directory, `import-report-${report.runId}.json`)
  const errorsPath = path.join(directory, `import-errors-${report.runId}.csv`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(errorsPath, `${errorsToCsv(report.rows)}\n`, 'utf8')
  return { json: jsonPath, errors: errorsPath }
}
