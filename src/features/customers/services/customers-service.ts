import { isCustomerKind, type CustomerKind } from '@/lib/constants/customers'
import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'
import { deviceTitle } from '@/features/devices/classification'

export type Customer = {
  id: string
  kind: CustomerKind
  name: string
  inn: string
  kpp: string
  ogrn: string
  phone: string
  email: string
  city: string
  contactName: string
  notes: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CustomerInput = {
  name: string
  kind: CustomerKind
  inn: string
  kpp: string
  ogrn: string
  phone: string
  email: string
  city: string
  contactName: string
  notes: string
}

export type CustomerListResult = {
  items: Customer[]
  total: number
}

export type CustomerDevice = {
  id: string
  serialNumber: string
  label: string
  groupName: string
  brandName: string
  modelName: string
}

export type CustomerOrder = {
  id: string
  number: string
  serialNumber: string
  deviceLabel: string
  statusName: string
  statusCode: string
  createdAt: string
}

export type CustomerHistoryEvent = {
  id: string
  action: string
  actorName: string
  summary: string
  createdAt: string
}

export type CustomerReceipt = {
  id: string
  supplier: string
  receiptDate: string
  notes: string
  createdAt: string
  actorName: string
  lineCount: number
  totalQuantity: number
}

export type CustomerCard = {
  customer: Customer
  devices: CustomerDevice[]
  orders: CustomerOrder[]
  receipts: CustomerReceipt[]
  history: CustomerHistoryEvent[]
}

export type CustomerInnMatch = {
  id: string
  name: string
  kind: CustomerKind
  inn: string
}

function mapKind(value: string): CustomerKind {
  return isCustomerKind(value) ? value : 'organization'
}

function mapCustomer(row: {
  id: string
  kind: string
  name: string
  inn: string
  kpp: string
  ogrn: string
  phone: string
  email: string
  city: string
  contact_name: string
  notes: string
  is_active: boolean
  created_at: string
  updated_at: string
}): Customer {
  return {
    id: row.id,
    kind: mapKind(row.kind),
    name: row.name,
    inn: row.inn,
    kpp: row.kpp,
    ogrn: row.ogrn,
    phone: row.phone,
    email: row.email,
    city: row.city,
    contactName: row.contact_name,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value
}

function asString(value: Json | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function historySummary(action: string, metadata: Json): string {
  const record = asRecord(metadata)
  const name = asString(record?.name)
  if (action === 'customers.created') {
    return name ? `Создан клиент «${name}»` : 'Создан клиент'
  }
  if (action === 'customers.updated') {
    return name ? `Изменён клиент «${name}»` : 'Изменён клиент'
  }
  return action
}

export async function listCustomers(
  search: string,
  page: number,
  pageSize: number,
  kind?: CustomerKind,
): Promise<CustomerListResult> {
  const { data, error } = await getSupabase().rpc('search_customers', {
    search_query: search,
    page_number: page,
    page_size: pageSize,
    active_only: false,
    kind_filter: kind ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить контакты.')
  }

  const rows = data ?? []
  return {
    items: rows.map(mapCustomer),
    total: rows[0]?.total_count ?? 0,
  }
}

export async function searchCustomers(
  queryText: string,
  page: number,
  pageSize: number,
): Promise<CustomerListResult> {
  const { data, error } = await getSupabase().rpc('search_customers', {
    search_query: queryText,
    page_number: page,
    page_size: pageSize,
    active_only: true,
  })

  if (error) {
    throw toAppError(error, 'Не удалось найти клиентов.')
  }

  const rows = data ?? []
  return {
    items: rows.map(mapCustomer),
    total: rows[0]?.total_count ?? 0,
  }
}

export async function findCustomersByInn(inn: string, excludeId?: string): Promise<CustomerInnMatch[]> {
  const term = inn.trim()
  if (!term) {
    return []
  }

  const { data, error } = await getSupabase().rpc('find_customers_by_inn', {
    inn_query: term,
    exclude_id: excludeId ?? null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось проверить ИНН.')
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: mapKind(row.kind),
    inn: row.inn,
  }))
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const card = await getCustomerCard(id)
  return card?.customer ?? null
}

export async function getCustomerCard(id: string): Promise<CustomerCard | null> {
  const { data, error } = await getSupabase().rpc('get_customer_card', {
    target_customer_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить клиента.')
  }

  const payload = asRecord(data)
  const customerRow = asRecord(payload?.customer)
  if (!customerRow?.id) {
    return null
  }

  const devicesRaw = payload?.devices
  const ordersRaw = payload?.orders
  const receiptsRaw = payload?.receipts
  const historyRaw = payload?.history

  return {
    customer: mapCustomer({
      id: asString(customerRow.id),
      kind: asString(customerRow.kind, 'organization'),
      name: asString(customerRow.name),
      inn: asString(customerRow.inn),
      kpp: asString(customerRow.kpp),
      ogrn: asString(customerRow.ogrn),
      phone: asString(customerRow.phone),
      email: asString(customerRow.email),
      city: asString(customerRow.city),
      contact_name: asString(customerRow.contact_name),
      notes: asString(customerRow.notes),
      is_active: customerRow.is_active === true,
      created_at: asString(customerRow.created_at),
      updated_at: asString(customerRow.updated_at),
    }),
    devices: Array.isArray(devicesRaw)
      ? devicesRaw.flatMap((item) => {
          const row = asRecord(item)
          if (!row?.id) {
            return []
          }
          return [
            {
              id: asString(row.id),
              serialNumber: asString(row.serial_number),
              label: deviceTitle({
                groupName: asString(row.group_name),
                brandName: asString(row.brand_name),
                modelName: asString(row.model_name),
                label: asString(row.label),
              }),
              groupName: asString(row.group_name),
              brandName: asString(row.brand_name),
              modelName: asString(row.model_name),
            },
          ]
        })
      : [],
    orders: Array.isArray(ordersRaw)
      ? ordersRaw.flatMap((item) => {
          const row = asRecord(item)
          if (!row?.id) {
            return []
          }
          return [
            {
              id: asString(row.id),
              number: asString(row.number),
              serialNumber: asString(row.serial_number),
              deviceLabel: deviceTitle({
                deviceLabel: asString(row.device_label),
              }),
              statusName: asString(row.status_name),
              statusCode: asString(row.status_code),
              createdAt: asString(row.created_at),
            },
          ]
        })
      : [],
    receipts: Array.isArray(receiptsRaw)
      ? receiptsRaw.flatMap((item) => {
          const row = asRecord(item)
          if (!row?.id) {
            return []
          }
          return [
            {
              id: asString(row.id),
              supplier: asString(row.supplier),
              receiptDate: asString(row.receipt_date),
              notes: asString(row.notes),
              createdAt: asString(row.created_at),
              actorName: asString(row.actor_name),
              lineCount: Number(row.line_count ?? 0),
              totalQuantity: Number(row.total_quantity ?? 0),
            },
          ]
        })
      : [],
    history: Array.isArray(historyRaw)
      ? historyRaw.flatMap((item) => {
          const row = asRecord(item)
          if (!row?.id) {
            return []
          }
          return [
            {
              id: asString(row.id),
              action: asString(row.action),
              actorName: asString(row.actor_name),
              summary: historySummary(asString(row.action), row.metadata ?? {}),
              createdAt: asString(row.created_at),
            },
          ]
        })
      : [],
  }
}

export async function createCustomer(input: CustomerInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_customer', {
    customer_name: input.name,
    customer_kind: input.kind,
    customer_inn: input.inn,
    customer_kpp: input.kpp,
    customer_ogrn: input.ogrn,
    customer_phone: input.phone,
    customer_email: input.email,
    customer_city: input.city,
    customer_contact_name: input.contactName,
    customer_notes: input.notes,
  })

  if (error) {
    throw toAppError(error, 'Не удалось создать клиента.')
  }

  return data
}

export async function updateCustomer(customerId: string, input: CustomerInput): Promise<void> {
  const { error } = await getSupabase().rpc('update_customer', {
    target_customer_id: customerId,
    customer_name: input.name,
    customer_kind: input.kind,
    customer_inn: input.inn,
    customer_kpp: input.kpp,
    customer_ogrn: input.ogrn,
    customer_phone: input.phone,
    customer_email: input.email,
    customer_city: input.city,
    customer_contact_name: input.contactName,
    customer_notes: input.notes,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить клиента.')
  }
}

export async function deleteCustomer(customerId: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_customer', {
    target_customer_id: customerId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить клиента.')
  }
}
