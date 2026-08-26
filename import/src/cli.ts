import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { loadDatasetDirectory } from './load-directory.ts'
import { createMemoryStore } from './memory-store.ts'
import { formatReportText, runImport } from './pipeline.ts'
import { createSupabaseStoreFromEnv } from './supabase-store.ts'
import { ImportPhase } from './types.ts'

function arg(name: string, fallback = ''): string {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
}

function printHelp() {
  process.stdout.write(`Импорт данных Эндотека (не UI).

Команды:
  preview --dir <каталог> --phase full|delta [--out <каталог>] [--store memory|supabase]
  import  --dir <каталог> --phase full|delta [--out <каталог>] [--store memory|supabase]
  retry   --run-id <id> --phase full|delta [--out <каталог>] [--store supabase]

Повторный запуск тех же файлов не создаёт дубликаты: ключ source_id либо детерминированное
сопоставление (код, ИНН/email, номер заказа, серийный номер). Похожие названия не склеиваются.

Переменные для supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
`)
}

async function main() {
  const command = process.argv[2]
  if (!command || command === '--help' || command === 'help') {
    printHelp()
    return
  }

  const phaseArg = arg('--phase', ImportPhase.Full)
  if (phaseArg !== ImportPhase.Full && phaseArg !== ImportPhase.Delta) {
    throw new Error('phase: full или delta.')
  }
  const storeName = arg('--store', 'supabase')
  const directory = arg('--dir')
  const outDir = arg('--out')
  const runId = arg('--run-id')
  const dryRun = command === 'preview'

  if ((command === 'preview' || command === 'import') && !directory) {
    throw new Error('Укажите --dir с CSV-файлами.')
  }
  if (command === 'retry' && !runId) {
    throw new Error('Укажите --run-id.')
  }

  const store = storeName === 'memory' ? createMemoryStore() : createSupabaseStoreFromEnv()
  const rows = directory ? await loadDatasetDirectory(directory) : {}
  if (outDir) {
    await mkdir(outDir, { recursive: true })
  }

  const report = await runImport({
    store,
    phase: phaseArg,
    rows,
    dryRun,
    sourceDir: directory,
    retryFromRunId: command === 'retry' ? runId : undefined,
    outDir: outDir || undefined,
  })

  process.stdout.write(`${formatReportText(report)}\n`)
  if (outDir) {
    process.stdout.write(`Отчёт: ${path.resolve(outDir)}\n`)
  }
  if (report.totals.failed > 0 && !dryRun) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
})
