import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadDatasetDirectory } from '../src/load-directory.ts'
import { createMemoryStore } from '../src/memory-store.ts'
import { runImport } from '../src/pipeline.ts'
import { ImportPhase } from '../src/types.ts'

const fixturesFull = path.join(fileURLToPath(new URL('../fixtures/full', import.meta.url)))

test('прерванный импорт продолжается без дубликатов', async () => {
  const store = createMemoryStore()
  const rows = await loadDatasetDirectory(fixturesFull)
  const interrupted = await runImport({
    store,
    phase: ImportPhase.Full,
    rows,
    abortAfter: 3,
  })
  const mid = store.snapshot()

  assert.equal(interrupted.status, 'interrupted')
  assert.equal(interrupted.totals.created, 3)
  assert.equal(mid.employees.length + mid.customers.length, 3)

  const resumed = await runImport({ store, phase: ImportPhase.Full, rows })
  const done = store.snapshot()

  assert.equal(resumed.status, 'completed')
  assert.equal(resumed.totals.failed, 0)
  assert.equal(done.employees.length, 2)
  assert.equal(done.customers.length, 2)
  assert.equal(done.items.length, 3)
  assert.equal(done.orders.length, 2)
  assert.equal(done.orders.map((row) => row.number).sort().join(','), 'ЗК-1001,ЗК-1002')
})

test('preview не пишет данные', async () => {
  const store = createMemoryStore()
  const rows = await loadDatasetDirectory(fixturesFull)
  const preview = await runImport({ store, phase: ImportPhase.Full, rows, dryRun: true })
  assert.equal(preview.status, 'preview')
  assert.ok(preview.totals.created > 0)
  assert.equal(store.snapshot().customers.length, 0)
  assert.equal(store.snapshot().items.length, 0)
})
