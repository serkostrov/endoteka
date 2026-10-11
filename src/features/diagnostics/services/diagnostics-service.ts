import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'
import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import { formatMoney, parseMoney } from '@/lib/utils/number'
import type { Json, OrderDiagnosticsItemRow } from '@/types/database'

export type OrderDiagnostics = {
  orderId: string
  engineerId: string | null
  engineerName: string
  conclusion: string
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
  updatedByName: string
}

export type DiagnosticChange = {
  field: string
  label: string
  from: Json | undefined
  to: Json | undefined
}

export type OrderJournalEvent = {
  id: string
  eventType: string
  summary: string
  actorId: string | null
  actorName: string
  payload: Json
  createdAt: string
  changes: DiagnosticChange[]
}

export type SaveDiagnosticsInput = {
  orderId: string
  fieldValues: Record<string, DynamicFieldValueData>
}

function mapDiagnostics(row: OrderDiagnosticsItemRow): OrderDiagnostics {
  return {
    orderId: row.order_id,
    engineerId: row.engineer_id,
    engineerName: row.engineer_name,
    conclusion: row.conclusion,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
  }
}

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value
}

function mapChanges(payload: Json): DiagnosticChange[] {
  const record = asRecord(payload)
  const raw = record?.changes
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.flatMap((item) => {
    const row = asRecord(item)
    if (!row || typeof row.field !== 'string') {
      return []
    }
    return [
      {
        field: row.field,
        label: typeof row.label === 'string' ? row.label : row.field,
        from: row.from,
        to: row.to,
      },
    ]
  })
}

export async function getOrderDiagnostics(orderId: string): Promise<OrderDiagnostics | null> {
  const { data, error } = await getSupabase()
    .from('order_diagnostics_items')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle()

  if (error) {
    throw toAppError(error, 'Не удалось загрузить диагностику.')
  }

  return data ? mapDiagnostics(data) : null
}

export async function saveOrderDiagnostics(input: SaveDiagnosticsInput): Promise<void> {
  const payload: Record<string, Json> = {}
  for (const [key, value] of Object.entries(input.fieldValues)) {
    payload[key] = value
  }

  const { error } = await getSupabase().rpc('save_order_diagnostics', {
    target_order_id: input.orderId,
    conclusion: '',
    target_engineer_id: null,
    field_values: payload,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить диагностику.')
  }
}

export async function addOrderJournalNote(orderId: string, body: string): Promise<void> {
  const { error } = await getSupabase().rpc('add_order_journal_note', {
    target_order_id: orderId,
    p_body: body,
  })

  if (error) {
    throw toAppError(error, 'Не удалось добавить событие в журнал.')
  }
}

export async function getOrderJournal(orderId: string): Promise<OrderJournalEvent[]> {
  const { data, error } = await getSupabase().rpc('get_order_journal', {
    target_order_id: orderId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить журнал заказа.')
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    summary: row.summary,
    actorId: row.actor_id,
    actorName: row.actor_name,
    payload: row.payload,
    createdAt: row.created_at,
    changes: mapChanges(row.payload),
  }))
}

function isMoneyJournalField(field?: string, label?: string) {
  const hay = `${field ?? ''} ${label ?? ''}`.toLowerCase()
  return /sum|total|price|amount|unit_price|сумм|цен|стоим|итог/.test(hay)
}

function formatJournalNumber(value: number, asMoney: boolean) {
  if (!Number.isFinite(value)) {
    return '—'
  }
  if (asMoney) {
    return `${formatMoney(value)} ₽`
  }
  return String(value)
}

/** Значение в diff журнала: суммы — с пробелом тысяч и ₽. */
export function formatJournalValue(
  value: Json | undefined,
  options?: { field?: string; label?: string; money?: boolean },
): string {
  const asMoney = options?.money ?? isMoneyJournalField(options?.field, options?.label)

  if (value === undefined || value === null) {
    return '—'
  }
  if (typeof value === 'number') {
    return formatJournalNumber(value, asMoney)
  }
  if (typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return '—'
    }
    if (asMoney) {
      const parsed = parseMoney(trimmed)
      if (parsed != null && /^-?\d+([.,]\d+)?$/.test(trimmed.replace(/\s/g, ''))) {
        return formatJournalNumber(parsed, true)
      }
    }
    return trimmed
  }
  return JSON.stringify(value)
}

/**
 * Текст summary журнала: суммы вроде «0 → 15000» или «Сумма: 12500.5»
 * приводим к «0,00 ₽ → 15 000,00 ₽».
 */
export function formatJournalSummary(summary: string): string {
  const text = summary.trim()
  if (!text) {
    return text
  }

  const looksLikeMoneyEvent =
    /сумм|итог|₽|руб/i.test(text) ||
    /^-?\d[\d\s.,]*\s*(→|->|—|-)\s*-?\d/.test(text)

  if (!looksLikeMoneyEvent) {
    return text
  }

  return text.replace(/-?\d+(?:[.,]\d+)?(?:\s*₽)?/g, (raw) => {
    const numPart = raw.replace(/\s*₽/g, '').trim()
    const parsed = parseMoney(numPart)
    if (parsed == null) {
      return raw
    }
    return `${formatMoney(parsed)} ₽`
  })
}

/** Основной текст события: для смены суммы — сразу «0,00 ₽ → 15 000,00 ₽». */
export function formatJournalEventBody(event: {
  eventType: string
  summary: string
  changes: DiagnosticChange[]
}): string {
  if (event.eventType === 'total_changed') {
    const change = event.changes.find((item) => item.field === 'total') ?? event.changes[0]
    if (change) {
      return `${formatJournalValue(change.from, { field: 'total', label: 'Сумма заказа' })} → ${formatJournalValue(change.to, { field: 'total', label: 'Сумма заказа' })}`
    }
  }
  return formatJournalSummary(event.summary)
}
