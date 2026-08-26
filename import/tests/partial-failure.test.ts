import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadDatasetDirectory } from '../src/load-directory.ts'
import { createMemoryStore } from '../src/memory-store.ts'
import { errorsToCsv } from '../src/report.ts'
import { runImport } from '../src/pipeline.ts'
import { ImportPhase } from '../src/types.ts'

const fixturesInvalid = path.join(fileURLToPath(new URL('../fixtures/invalid', import.meta.url)))

test('частичный отказ не останавливает импорт и попадает в отчёт', async () => {
  const store = createMemoryStore()
  const report = await runImport({
    store,
    phase: ImportPhase.Full,
    rows: await loadDatasetDirectory(fixturesInvalid),
  })
  const snap = store.snapshot()
  const csv = errorsToCsv(report.rows)

  assert.ok(report.totals.created >= 3)
  assert.ok(report.totals.failed >= 3)
  assert.equal(snap.customers.length, 1)
  assert.equal(snap.items.length, 1)
  assert.equal(snap.orders.length, 1)
  assert.match(csv, /no_identity|Укажите название|серийного номера|не найдена/)
  assert.equal(
    report.rows.some((row) => row.status === 'failed' && row.errorCode === 'no_identity'),
    true,
  )
  assert.equal(
    report.rows.some((row) => row.dataset === 'customers' && row.status === 'created'),
    true,
  )
})

test('клиент только с названием без ключа не склеивается наугад', async () => {
  const store = createMemoryStore()
  const report = await runImport({
    store,
    phase: ImportPhase.Full,
    rows: {
      customers: [{ name: 'ООО Мир', kind: 'organization', inn: '', email: '' }],
    },
  })
  assert.equal(report.totals.created, 0)
  assert.equal(report.totals.failed, 1)
  assert.equal(store.snapshot().customers.length, 0)
})
