import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'
import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
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
  conclusion: string
  engineerId: string | null
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
    conclusion: input.conclusion,
    target_engineer_id: input.engineerId,
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

export function formatJournalValue(value: Json | undefined): string {
  if (value === undefined || value === null) {
    return '—'
  }
  if (typeof value === 'string') {
    return value.trim() || '—'
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}
