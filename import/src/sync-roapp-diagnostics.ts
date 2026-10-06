/**
 * Диагностика и журнал заказа из RO App.
 *
 * Поля «Техническое состояние» в RO App — custom fields заказа.
 * События: заметки, заключение, состояние прибора (asset.state).
 * Фото/лента комментариев Public API не отдаёт (GET comments = 405, files = 404).
 *
 *   ROAPP_API_KEY=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npm run import:roapp-diagnostics
 *
 *   --dry-run   только отчёт
 *   --force     перезаписать уже заполненные поля CRM
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const RO_BASE = 'https://api.roapp.io/v2'
const PAGE_DELAY_MS = 200

type RoCustomField = { id: number; title: string; type: number }
type RoOrder = {
  id: number
  number: string
  created_at?: string
  modified_at?: string
  malfunction?: string
  manager_notes?: string
  engineer_notes?: string
  resume?: string
  custom_fields?: Record<string, string>
  asset?: { id?: number; state?: string; uid?: string } | null
}

type DiagField = { id: string; code: string; name: string; field_type: string }

const SKIP_RO_TITLES = new Set(['комплектация', 'компания исполнитель'])

const TITLE_ALIASES: Record<string, string> = {
  герметичность: 'germetichnost',
  'подача воды/воздуха': 'podacha_vody_vozduha',
  'кнопки управления': 'knopki_upravleniya',
  'видеоизображение/фиброволкно': 'videoizobrazhenie_fibrovolkno',
  'видеоизображение/фиброволокно': 'videoizobrazhenie_fibrovolkno',
  'волокно подсветки': 'volokno_podsvetki',
  'дистальная головка': 'distalnaya_golovka',
  'а - резина': 'a_rezina',
  'а-резина': 'a_rezina',
  'изгибаемая часть': 'izgibaemaya_chast',
  'трубка вводимая': 'trubka_vvodimaya',
  'канал инструментальный': 'kanal_instrumentalnyj',
  'канал подачи воды/воздуха': 'kanal_podachi_vody_vozduha',
  'канал доп. подачи воды': 'kanal_dop_podachi_vody',
  'трубка универсальная': 'trubka_universalnaya',
  коннектор: 'konnektor',
  'прочие дефекты': 'prochie_defekty',
  заключение: 'zaklyuchenie',
  'сопроводительная записка': '_cover_letter',
}

const STATE_RULES: Array<{ re: RegExp; code: string }> = [
  { re: /герметич/i, code: 'germetichnost' },
  { re: /кнопк/i, code: 'knopki_upravleniya' },
  { re: /видео|фибро|изображен|камер/i, code: 'videoizobrazhenie_fibrovolkno' },
  { re: /подсвет|оптоволок/i, code: 'volokno_podsvetki' },
  { re: /дистальн|колпачк/i, code: 'distalnaya_golovka' },
  { re: /а[-\s]?резин/i, code: 'a_rezina' },
  { re: /изгибаем/i, code: 'izgibaemaya_chast' },
  { re: /коннектор/i, code: 'konnektor' },
  { re: /вводим/i, code: 'trubka_vvodimaya' },
  { re: /инструментальн/i, code: 'kanal_instrumentalnyj' },
  { re: /доп\.?\s*подач|доп\.?\s*вод/i, code: 'kanal_dop_podachi_vody' },
  { re: /канал.{0,24}вод|вод[аы].{0,12}воздух/i, code: 'kanal_podachi_vody_vozduha' },
  { re: /универсальн/i, code: 'trubka_universalnaya' },
  { re: /подач/i, code: 'podacha_vody_vozduha' },
]

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

function text(value: unknown) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim()
}

async function roGet<T>(apiKey: string, pathName: string): Promise<T> {
  const response = await fetch(`${RO_BASE}${pathName}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`RO App ${pathName} → ${response.status} ${body.slice(0, 240)}`)
  }
  return (await response.json()) as T
}

function parseAssetState(state: string): Record<string, string> {
  const parts = state
    .split(/[;•]|,(?=\s)/)
    .map((part) => part.trim())
    .filter(Boolean)
  const values: Record<string, string> = {}
  const leftover: string[] = []
  for (const part of parts) {
    const rule = STATE_RULES.find((item) => item.re.test(part))
    if (!rule) {
      leftover.push(part)
      continue
    }
    const current = values[rule.code]
    values[rule.code] = current ? `${current}; ${part}` : part
  }
  if (leftover.length > 0) {
    values.prochie_defekty = leftover.join('; ')
  }
  return values
}

function pickRoProtocol(
  order: RoOrder,
  idToCode: Map<string, string>,
): { fields: Record<string, string>; extras: Record<string, string>; parsedFromAsset: boolean } {
  const fields: Record<string, string> = {}
  const extras: Record<string, string> = {}
  const raw = order.custom_fields ?? {}
  let protocolFilled = 0
  for (const [key, value] of Object.entries(raw)) {
    const body = text(value)
    if (!body || body === '-' || body === '.' || body === '—') {
      continue
    }
    const code = idToCode.get(key) ?? idToCode.get(key.replace(/^f/i, ''))
    if (!code) {
      continue
    }
    if (code.startsWith('_')) {
      extras[code] = body
      continue
    }
    fields[code] = body
    if (code !== 'zaklyuchenie') {
      protocolFilled += 1
    }
  }

  const state = text(order.asset?.state)
  let parsedFromAsset = false
  if (protocolFilled === 0 && state) {
    const parsed = parseAssetState(state)
    for (const [code, body] of Object.entries(parsed)) {
      if (!fields[code]) {
        fields[code] = body
      }
    }
    extras._asset_state = state
    parsedFromAsset = Object.keys(parsed).length > 0
  } else if (state) {
    extras._asset_state = state
  }

  const malfunction = text(order.malfunction)
  const engineer = text(order.engineer_notes)
  const manager = text(order.manager_notes)
  const resume = text(order.resume)
  if (malfunction) extras._malfunction = malfunction
  if (engineer) extras._engineer_notes = engineer
  if (manager) extras._manager_notes = manager
  if (resume) extras._resume = resume

  return { fields, extras, parsedFromAsset }
}

async function loadAllOrders(apiKey: string): Promise<RoOrder[]> {
  const first = await roGet<{ paging: { total_pages: number }; data: RoOrder[] }>(
    apiKey,
    '/orders?page=1',
  )
  const orders = [...(first.data ?? [])]
  const totalPages = first.paging?.total_pages ?? 1
  for (let page = 2; page <= totalPages; page += 1) {
    await sleep(PAGE_DELAY_MS)
    const chunk = await roGet<{ data: RoOrder[] }>(apiKey, `/orders?page=${page}`)
    orders.push(...(chunk.data ?? []))
    process.stdout.write(`RO App заказы: стр. ${page}/${totalPages} (всего ${orders.length})\n`)
  }
  return orders
}

async function existingImportKeys(
  supabase: SupabaseClient,
  orderId: string,
): Promise<Set<string>> {
  const keys = new Set<string>()
  const { data, error } = await supabase
    .from('order_journal_events')
    .select('payload')
    .eq('order_id', orderId)
    .eq('event_type', 'comment')
  if (error) {
    throw new Error(error.message)
  }
  for (const row of data ?? []) {
    const payload = row.payload as { import_key?: string } | null
    if (payload?.import_key) {
      keys.add(payload.import_key)
    }
  }
  return keys
}

async function main() {
  const apiKey = process.env.ROAPP_API_KEY?.trim()
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!apiKey || !url || !key) {
    throw new Error('Нужны ROAPP_API_KEY, SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.')
  }
  const dryRun = process.argv.includes('--dry-run')
  const force = process.argv.includes('--force')
  const outDir = path.resolve(arg('--out', 'import/reports/roapp-diagnostics'))
  await mkdir(outDir, { recursive: true })

  process.stdout.write(`CRM: ${url}\n`)

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: fieldRows, error: fieldError } = await supabase
    .from('dynamic_fields')
    .select('id, code, name, field_type')
    .eq('entity_code', 'diagnostics')
    .eq('is_active', true)
  if (fieldError) {
    throw new Error(fieldError.message)
  }
  const diagFields = (fieldRows ?? []) as DiagField[]
  const fieldByCode = new Map(diagFields.map((row) => [row.code, row] as const))
  const codeByCrmTitle = new Map(diagFields.map((row) => [normTitle(row.name), row.code] as const))

  const roFields = await roGet<RoCustomField[]>(apiKey, '/orders/custom-fields')
  const idToCode = new Map<string, string>()
  for (const field of roFields) {
    const title = normTitle(field.title)
    if (SKIP_RO_TITLES.has(title)) {
      continue
    }
    const code = TITLE_ALIASES[title] ?? codeByCrmTitle.get(title)
    if (!code) {
      process.stdout.write(`Нет маппинга RO поля «${field.title}» (${field.id})\n`)
      continue
    }
    idToCode.set(`f${field.id}`, code)
    idToCode.set(String(field.id), code)
  }

  const orderByNumber = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('orders').select('id, number').range(from, from + 999)
    if (error) {
      throw new Error(error.message)
    }
    const chunk = data ?? []
    for (const row of chunk) {
      orderByNumber.set(row.number, row.id)
    }
    if (chunk.length < 1000) {
      break
    }
  }

  const roOrders = await loadAllOrders(apiKey)
  const report: string[] = [
    'number,status,fields,notes,parsed_from_asset',
  ]

  let matched = 0
  let protocols = 0
  let notes = 0
  let missing = 0
  let skippedEmpty = 0

  for (const order of roOrders) {
    const crmId = orderByNumber.get(String(order.number || ''))
    if (!crmId) {
      missing += 1
      report.push(`${order.number},missing_in_crm,0,0,0`)
      continue
    }
    matched += 1
    const picked = pickRoProtocol(order, idToCode)
    const fieldCount = Object.keys(picked.fields).length
    const extraCount = Object.keys(picked.extras).length
    const fromAsset = picked.parsedFromAsset ? 1 : 0
    if (fieldCount === 0 && extraCount === 0) {
      skippedEmpty += 1
      report.push(`${order.number},empty,0,0,0`)
      continue
    }

    const { data: existingValues, error: valuesError } = await supabase
      .from('dynamic_field_values')
      .select('field_id, value')
      .eq('entity_code', 'diagnostics')
      .eq('record_id', crmId)
    if (valuesError) {
      throw new Error(valuesError.message)
    }
    const currentByFieldId = new Map(
      (existingValues ?? []).map((row) => [row.field_id, row.value] as const),
    )

    const toWrite: Array<{ field_id: string; entity_code: string; record_id: string; value: string }> =
      []
    for (const [code, body] of Object.entries(picked.fields)) {
      const field = fieldByCode.get(code)
      if (!field) {
        continue
      }
      const existing = currentByFieldId.get(field.id)
      const existingText =
        typeof existing === 'string'
          ? existing
          : existing != null
            ? text(existing)
            : ''
      if (existingText && !force) {
        continue
      }
      toWrite.push({
        field_id: field.id,
        entity_code: 'diagnostics',
        record_id: crmId,
        value: body,
      })
    }

    const conclusion = picked.fields.zaklyuchenie ?? ''

    if (!dryRun && (toWrite.length > 0 || conclusion || fieldCount > 0 || extraCount > 0)) {
      const { error: diagError } = await supabase.from('order_diagnostics').upsert(
        {
          order_id: crmId,
          conclusion,
          updated_at: order.modified_at || order.created_at || new Date().toISOString(),
        },
        { onConflict: 'order_id' },
      )
      if (diagError) {
        throw new Error(`${order.number}: ${diagError.message}`)
      }
      if (toWrite.length > 0) {
        const { error: upsertError } = await supabase
          .from('dynamic_field_values')
          .upsert(toWrite, { onConflict: 'field_id,record_id' })
        if (upsertError) {
          throw new Error(`${order.number} fields: ${upsertError.message}`)
        }
      }
    }

    if (toWrite.length > 0 || conclusion) {
      protocols += 1
    }

    const journalBits: Array<{ key: string; body: string }> = []
    if (picked.extras._cover_letter) {
      journalBits.push({
        key: `roapp:${order.id}:cover`,
        body: `Сопроводительная записка (RO App):\n${picked.extras._cover_letter}`,
      })
    }
    if (picked.extras._malfunction) {
      journalBits.push({
        key: `roapp:${order.id}:malfunction`,
        body: `Неисправность (RO App):\n${picked.extras._malfunction}`,
      })
    }
    if (picked.extras._engineer_notes) {
      journalBits.push({
        key: `roapp:${order.id}:engineer`,
        body: `Заметки инженера (RO App):\n${picked.extras._engineer_notes}`,
      })
    }
    if (picked.extras._manager_notes) {
      journalBits.push({
        key: `roapp:${order.id}:manager`,
        body: `Заметки менеджера (RO App):\n${picked.extras._manager_notes}`,
      })
    }
    if (picked.extras._resume) {
      journalBits.push({
        key: `roapp:${order.id}:resume`,
        body: `Резюме (RO App):\n${picked.extras._resume}`,
      })
    }
    if (picked.extras._asset_state) {
      journalBits.push({
        key: `roapp:${order.id}:asset_state`,
        body: `Состояние прибора (RO App):\n${picked.extras._asset_state}`,
      })
    }

    const seen = dryRun ? new Set<string>() : await existingImportKeys(supabase, crmId)
    for (const bit of journalBits) {
      if (seen.has(bit.key)) {
        continue
      }
      notes += 1
      if (dryRun) {
        continue
      }
      const createdAt = order.created_at || new Date().toISOString()
      const { error: journalError } = await supabase.from('order_journal_events').insert({
        order_id: crmId,
        event_type: 'comment',
        actor_id: null,
        summary: bit.body.slice(0, 4000),
        payload: { body: bit.body, import_key: bit.key, source: 'roapp' },
        created_at: createdAt,
      })
      if (journalError) {
        throw new Error(`${order.number} journal: ${journalError.message}`)
      }
    }

    report.push(
      `${order.number},${dryRun ? 'dry' : 'ok'},${toWrite.length},${journalBits.length},${fromAsset}`,
    )
  }

  await writeFile(path.join(outDir, 'diagnostics-sync.csv'), `${report.join('\n')}\n`, 'utf8')
  process.stdout.write(
    [
      dryRun ? 'DRY-RUN' : 'DONE',
      `crm=${url}`,
      `matched_orders=${matched}`,
      `protocols=${protocols}`,
      `journal_notes=${notes}`,
      `empty_in_ro=${skippedEmpty}`,
      `missing_in_crm=${missing}`,
      `report=${path.join(outDir, 'diagnostics-sync.csv')}`,
      'Фото/чат RO App API не отдаёт — в журнал попали заметки, заключение и состояние прибора.',
      '',
    ].join('\n'),
  )
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
