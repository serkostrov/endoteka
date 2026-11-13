/**
 * Задачи RO App → tasks.
 *
 * Идемпотентно по import_source_keys (ext:tasks:ro-task-{id}).
 * Уже созданные задачи не обновляются.
 *
 *   ROAPP_API_KEY=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npm run import:roapp-tasks
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { createClient } from '@supabase/supabase-js'

const RO_BASE = 'https://api.roapp.io/v2'
const PAGE_DELAY_MS = 250

type RoEmployee = {
  id: number
  first_name?: string
  last_name?: string
  email?: string
}

type RoTask = {
  id: number
  title?: string
  description?: string
  status?: { id?: number; name?: string; group?: { type?: number; name?: string } }
  priority?: string
  author_id?: number | null
  assignee_ids?: number[]
  due_date?: string | null
  created_at?: string
  modified_at?: string
  related_object?: { type?: string; id?: number; name?: string } | null
}

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

async function fetchAll<T>(apiKey: string, pathName: string, label: string): Promise<T[]> {
  const first = await roGet<{ paging?: { total_pages?: number; count?: number }; data?: T[] }>(
    apiKey,
    `${pathName}?page=1`,
  )
  const totalPages = Math.max(1, first.paging?.total_pages ?? 1)
  const rows = [...(first.data ?? [])]
  process.stdout.write(`${label}: 1/${totalPages}\n`)
  for (let page = 2; page <= totalPages; page += 1) {
    await sleep(PAGE_DELAY_MS)
    const next = await roGet<{ data?: T[] }>(apiKey, `${pathName}?page=${page}`)
    rows.push(...(next.data ?? []))
    process.stdout.write(`${label}: ${page}/${totalPages}\n`)
  }
  return rows
}

function employeeLabel(employee: RoEmployee | undefined, id: number) {
  if (!employee) {
    return `id ${id}`
  }
  const name = [employee.last_name, employee.first_name]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return name || String(employee.email ?? '').trim() || `id ${id}`
}

function mapPriority(value: string) {
  const n = value.trim().toLowerCase()
  if (n === 'low' || n === 'lowest') {
    return 'low'
  }
  if (n === 'high' || n === 'highest' || n === 'urgent') {
    return 'high'
  }
  return 'normal'
}

function isCompleted(status: RoTask['status']) {
  if (status?.group?.type === 6) {
    return true
  }
  const name = `${status?.name ?? ''} ${status?.group?.name ?? ''}`.toLocaleLowerCase('ru')
  return name.includes('готов') || name.includes('выполнен') || name.includes('закры')
}

function orderNumberFromRelated(name: string) {
  const head = name.split('|')[0]?.trim() ?? ''
  return head
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
  const outDir = path.resolve(arg('--out', 'import/reports/roapp-tasks'))
  await mkdir(outDir, { recursive: true })

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const employees = await fetchAll<RoEmployee>(apiKey, '/company/employees', 'Сотрудники')
  const employeesById = new Map(employees.filter((row) => row?.id).map((row) => [row.id, row] as const))

  const { data: profiles, error: profileError } = await supabase.from('profiles').select('id, email')
  if (profileError) {
    throw new Error(profileError.message)
  }
  const profileByEmail = new Map(
    (profiles ?? [])
      .map((row) => [String(row.email ?? '').trim().toLowerCase(), row.id] as const)
      .filter(([email]) => email),
  )

  const orderBySource = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('import_source_keys')
      .select('source_key, entity_id')
      .eq('dataset', 'orders')
      .range(from, from + 999)
    if (error) {
      throw new Error(error.message)
    }
    const chunk = data ?? []
    for (const row of chunk) {
      orderBySource.set(row.source_key, row.entity_id)
    }
    if (chunk.length < 1000) {
      break
    }
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

  const existing = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('import_source_keys')
      .select('source_key')
      .eq('dataset', 'tasks')
      .range(from, from + 999)
    if (error) {
      throw new Error(error.message)
    }
    const chunk = data ?? []
    for (const row of chunk) {
      existing.add(row.source_key)
    }
    if (chunk.length < 1000) {
      break
    }
  }

  const tasks = await fetchAll<RoTask>(apiKey, '/tasks', 'Задачи')
  const report = ['id,status,order,assignee,note']
  let created = 0
  let skipped = 0
  let failed = 0
  let orderUnmatched = 0

  for (const task of tasks) {
    const sourceKey = `ext:tasks:ro-task-${task.id}`
    if (existing.has(sourceKey)) {
      skipped += 1
      report.push(`${task.id},skipped,,,`)
      continue
    }

    const title = String(task.title ?? '').trim() || `Задача RO ${task.id}`
    const description = String(task.description ?? '').trim()
    const statusName = String(task.status?.name ?? '').trim()
    const completed = isCompleted(task.status)
    const priority = mapPriority(String(task.priority ?? ''))
    const dueDate = task.due_date ? String(task.due_date).slice(0, 10) : null

    const assigneeIds = (task.assignee_ids ?? []).filter((value) => Number.isFinite(value))
    let assigneeId: string | null = null
    const unmatchedAssignees: string[] = []
    for (const employeeId of assigneeIds) {
      const email = String(employeesById.get(employeeId)?.email ?? '').trim().toLowerCase()
      const profileId = email ? profileByEmail.get(email) : undefined
      if (profileId && !assigneeId) {
        assigneeId = profileId
      } else if (!profileId) {
        unmatchedAssignees.push(employeeLabel(employeesById.get(employeeId), employeeId))
      }
    }

    let authorId: string | null = null
    if (typeof task.author_id === 'number') {
      const email = String(employeesById.get(task.author_id)?.email ?? '').trim().toLowerCase()
      authorId = email ? (profileByEmail.get(email) ?? null) : null
    }

    let orderId: string | null = null
    let orderNote = ''
    const related = task.related_object
    if (related?.type === 'order' && related.id) {
      orderId =
        orderBySource.get(`ext:orders:ro-ord-${related.id}`) ??
        orderByNumber.get(orderNumberFromRelated(String(related.name ?? ''))) ??
        null
      if (!orderId) {
        orderUnmatched += 1
        orderNote = `Заказ RO App: ${related.name || related.id}`
      }
    } else if (related?.type && related.type !== 'order') {
      orderNote = `Связь RO App: ${related.type} ${related.name || related.id || ''}`.trim()
    }

    const bodyParts = [
      statusName ? `Статус RO App: ${statusName}` : '',
      description,
      unmatchedAssignees.length > 0
        ? `Исполнитель RO App (учётной записи в CRM нет): ${unmatchedAssignees.join(', ')}`
        : '',
      orderNote,
    ].filter(Boolean)

    const createdAt = task.created_at || new Date().toISOString()
    const payload = {
      title,
      body: bodyParts.join('\n\n'),
      assignee_id: assigneeId,
      due_date: dueDate,
      priority,
      completed,
      order_id: orderId,
      created_by: authorId,
      created_at: createdAt,
      completed_at: completed ? task.modified_at || createdAt : null,
    }

    if (dryRun) {
      created += 1
      report.push(`${task.id},dry,${orderId ? 'linked' : orderNote ? 'unlinked' : ''},${assigneeId ? 'profile' : 'none'},`)
      continue
    }

    const { data, error } = await supabase.from('tasks').insert(payload).select('id').single()
    if (error || !data) {
      failed += 1
      report.push(`${task.id},failed,,,${(error?.message ?? 'insert').replaceAll(',', ' ')}`)
      continue
    }
    const { error: keyError } = await supabase.from('import_source_keys').insert({
      dataset: 'tasks',
      source_key: sourceKey,
      entity_type: 'task',
      entity_id: data.id,
      payload_hash: `task:${task.id}:${title}:${completed}`,
    })
    if (keyError) {
      throw new Error(keyError.message)
    }
    existing.add(sourceKey)
    created += 1
    report.push(`${task.id},created,${orderId ? 'linked' : orderNote ? 'unlinked' : ''},${assigneeId ? 'profile' : 'none'},`)
  }

  await writeFile(path.join(outDir, 'tasks-sync.csv'), `${report.join('\n')}\n`, 'utf8')
  process.stdout.write(
    [
      dryRun ? 'DRY-RUN' : 'DONE',
      `tasks_ro=${tasks.length}`,
      `created=${created}`,
      `skipped=${skipped}`,
      `failed=${failed}`,
      `order_unmatched=${orderUnmatched}`,
      `report=${path.join(outDir, 'tasks-sync.csv')}`,
      '',
    ].join('\n'),
  )
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
})
