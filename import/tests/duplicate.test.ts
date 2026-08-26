import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadDatasetDirectory } from '../src/load-directory.ts'
import { createMemoryStore } from '../src/memory-store.ts'
import { runImport } from '../src/pipeline.ts'
import { ImportPhase } from '../src/types.ts'

const fixturesFull = path.join(fileURLToPath(new URL('../fixtures/full', import.meta.url)))
const fixturesDelta = path.join(fileURLToPath(new URL('../fixtures/delta', import.meta.url)))

test('повторный импорт тех же данных не создаёт дубликаты', async () => {
  const store = createMemoryStore()
  const rows = await loadDatasetDirectory(fixturesFull)
  const first = await runImport({ store, phase: ImportPhase.Full, rows })
  const afterFirst = store.snapshot()
  const second = await runImport({ store, phase: ImportPhase.Full, rows })
  const afterSecond = store.snapshot()

  assert.equal(first.status, 'completed')
  assert.equal(first.totals.failed, 0)
  assert.ok(first.totals.created > 0)
  assert.equal(second.totals.created, 0)
  assert.equal(second.totals.failed, 0)
  assert.equal(second.totals.skipped, first.totals.created + first.totals.updated + first.totals.skipped)
  assert.equal(afterSecond.customers.length, afterFirst.customers.length)
  assert.equal(afterSecond.items.length, afterFirst.items.length)
  assert.equal(afterSecond.orders.length, afterFirst.orders.length)
  assert.equal(afterSecond.employees.length, afterFirst.employees.length)
  assert.equal(afterSecond.movements.length, afterFirst.movements.length)
})

test('дельта обновляет цены и добавляет новые записи', async () => {
  const store = createMemoryStore()
  await runImport({ store, phase: ImportPhase.Full, rows: await loadDatasetDirectory(fixturesFull) })
  const delta = await runImport({
    store,
    phase: ImportPhase.Delta,
    rows: await loadDatasetDirectory(fixturesDelta),
  })
  const snap = store.snapshot()
  const item = snap.items.find((row) => row.code === 'N-1001')
  const added = snap.items.find((row) => row.code === 'N-1004')

  assert.equal(delta.totals.failed, 0)
  assert.ok((delta.totals.created ?? 0) >= 2)
  assert.equal(item?.purchasePrice, 130)
  assert.ok(added)
  assert.equal(snap.orders.length, 3)
})
