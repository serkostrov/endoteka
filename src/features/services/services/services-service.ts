import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export type ServiceTemplate = {
  id: string
  name: string
  description: string
  unitPrice: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ServiceTemplateListResult = {
  items: ServiceTemplate[]
  total: number
}

export type ServiceTemplateInput = {
  name: string
  description: string
  unitPrice: number
  isActive?: boolean
}

export type OrderServiceLine = {
  id: string
  orderId: string
  templateId: string | null
  name: string
  description: string
  quantity: number
  unitPrice: number
  createdAt: string
}

export async function searchServiceTemplates(
  query: string,
  page: number,
  pageSize: number,
  activeOnly = false,
): Promise<ServiceTemplateListResult> {
  const { data, error } = await getSupabase().rpc('search_service_templates', {
    search_query: query,
    page_number: page,
    page_size: pageSize,
    active_only: activeOnly,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить услуги.')
  }

  const rows = data ?? []
  return {
    items: rows.map(mapTemplate),
    total: rows[0]?.total_count ?? 0,
  }
}

export async function createServiceTemplate(input: ServiceTemplateInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_service_template', {
    template_name: input.name,
    template_description: input.description,
    template_unit_price: input.unitPrice,
  })

  if (error) {
    throw toAppError(error, 'Не удалось создать услугу.')
  }

  return data
}

export async function updateServiceTemplate(id: string, input: ServiceTemplateInput): Promise<void> {
  const { error } = await getSupabase().rpc('update_service_template', {
    target_id: id,
    template_name: input.name,
    template_description: input.description,
    template_unit_price: input.unitPrice,
    template_is_active: input.isActive ?? true,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить услугу.')
  }
}

export async function deleteServiceTemplate(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_service_template', {
    target_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить услугу.')
  }
}

export async function getOrderServiceLines(orderId: string): Promise<OrderServiceLine[]> {
  const { data, error } = await getSupabase().rpc('get_order_service_lines', {
    target_order_id: orderId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить услуги заказа.')
  }

  if (!Array.isArray(data)) {
    return []
  }

  return data.flatMap((row) => {
    const mapped = mapLine(row)
    return mapped ? [mapped] : []
  })
}

export async function addOrderServiceLine(
  orderId: string,
  templateId: string,
  quantity: number,
  unitPrice: number,
): Promise<string> {
  const { data, error } = await getSupabase().rpc('add_order_service_line', {
    target_order_id: orderId,
    target_template_id: templateId,
    line_quantity: quantity,
    line_unit_price: unitPrice,
  })

  if (error) {
    throw toAppError(error, 'Не удалось добавить услугу.')
  }

  return data
}

export async function setOrderServiceLine(lineId: string, quantity: number, unitPrice: number): Promise<void> {
  const { error } = await getSupabase().rpc('set_order_service_line', {
    target_line_id: lineId,
    line_quantity: quantity,
    line_unit_price: unitPrice,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить услугу.')
  }
}

export async function removeOrderServiceLine(lineId: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_order_service_line', {
    target_line_id: lineId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить услугу из заказа.')
  }
}

function mapTemplate(row: {
  id: string
  name: string
  description: string
  unit_price: number | string
  is_active: boolean
  created_at: string
  updated_at: string
}): ServiceTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    unitPrice: asNumber(row.unit_price),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapLine(value: Json): OrderServiceLine | null {
  const row = asRecord(value)
  if (!row || typeof row.id !== 'string' || typeof row.order_id !== 'string') {
    return null
  }

  return {
    id: row.id,
    orderId: row.order_id,
    templateId: typeof row.template_id === 'string' ? row.template_id : null,
    name: asString(row.name),
    description: asString(row.description),
    quantity: asNumber(row.quantity),
    unitPrice: asNumber(row.unit_price),
    createdAt: asString(row.created_at),
  }
}

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value
}

function asString(value: Json | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: Json | number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
