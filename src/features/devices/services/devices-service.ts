import { AppError, toAppError } from '@/lib/errors'
import { DEVICE_PAGE_SIZE, isWarrantyStatus, SERIAL_LOOKUP_MIN_LENGTH, type WarrantyStatus } from '@/lib/constants/devices'
import { getSupabase } from '@/lib/supabase/client'
import type { DeviceListItemRow, Json } from '@/types/database'

export class DeviceDuplicateError extends AppError {
  readonly existingDeviceId: string | null

  constructor(existingDeviceId: string | null, cause?: unknown) {
    super('DEVICE_DUPLICATE', 'Прибор с таким серийным номером уже существует', cause)
    this.existingDeviceId = existingDeviceId
  }
}

export function isDeviceDuplicateError(error: unknown): error is DeviceDuplicateError {
  return error instanceof DeviceDuplicateError
}

export type DeviceWarranty = {
  id: string
  startsOn: string
  endsOn: string
  status: WarrantyStatus
  orderId: string | null
  orderNumber: string
  createdAt?: string
}

export type DeviceRepair = {
  id: string
  number: string
  customerId: string
  customerName: string
  statusName: string
  statusCode: string
  claimedMalfunction: string
  createdAt: string
  updatedAt: string
  deadline: string | null
}

export type Device = {
  id: string
  serialNumber: string
  groupId: string | null
  brandId: string | null
  modelId: string | null
  modificationId: string | null
  groupName: string
  brandName: string
  modelName: string
  modificationName: string
  label: string
  notes: string
  warranty: DeviceWarranty | null
  createdAt: string
  updatedAt: string
}

export type DeviceSearchItem = {
  id: string
  serialNumber: string
  label: string
  groupName: string
  brandName: string
  modelName: string
}

export type DeviceLookup = Device & {
  latestOrder: DeviceRepair | null
  repairs: DeviceRepair[]
}

export type SerialSearchResult = {
  kind: 'empty' | 'exact' | 'list'
  device: DeviceLookup | null
  items: DeviceSearchItem[]
}

export type DeviceCard = {
  device: DeviceLookup
  warranties: DeviceWarranty[]
}

export type DeviceInput = {
  serialNumber: string
  customerId: string | null
  groupId: string | null
  brandId: string | null
  modelId: string | null
  modificationId: string | null
}

export type UpdateDeviceInput = {
  deviceId: string
  groupId: string | null
  brandId: string | null
  modelId: string | null
  modificationId: string | null
}

export type WarrantyDefaults = {
  startsOn: string
  endsOn: string
  defaultMonths: number
}

function sanitizeSearch(value: string) {
  return value.replace(/[%_,]/g, '').trim()
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

function asStringOrNull(value: Json | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function mapWarranty(value: Json | null | undefined): DeviceWarranty | null {
  const row = asRecord(value)
  if (!row) {
    return null
  }

  const status = asString(row.status)
  if (!isWarrantyStatus(status) || !row.id || !row.starts_on || !row.ends_on) {
    return null
  }

  return {
    id: asString(row.id),
    startsOn: asString(row.starts_on),
    endsOn: asString(row.ends_on),
    status,
    orderId: asStringOrNull(row.order_id),
    orderNumber: asString(row.order_number),
    createdAt: asStringOrNull(row.created_at) ?? undefined,
  }
}

function mapRepair(value: Json): DeviceRepair | null {
  const row = asRecord(value)
  if (!row?.id || !row.number) {
    return null
  }

  return {
    id: asString(row.id),
    number: asString(row.number),
    customerId: asString(row.customer_id),
    customerName: asString(row.customer_name),
    statusName: asString(row.status_name),
    statusCode: asString(row.status_code),
    claimedMalfunction: asString(row.claimed_malfunction),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deadline: asStringOrNull(row.deadline),
  }
}

function mapLookup(value: Json | null | undefined): DeviceLookup | null {
  const row = asRecord(value)
  if (!row?.id) {
    return null
  }

  const brandName = asString(row.brand_name)
  const modelName = asString(row.model_name)
  const modificationName = asString(row.modification_name)
  const repairs = Array.isArray(row.repairs) ? row.repairs.flatMap((item) => (item ? [mapRepair(item)] : [])) : []

  return {
    id: asString(row.id),
    serialNumber: asString(row.serial_number),
    groupId: asStringOrNull(row.group_id),
    brandId: asStringOrNull(row.brand_id),
    modelId: asStringOrNull(row.model_id),
    modificationId: asStringOrNull(row.modification_id),
    groupName: asString(row.group_name),
    brandName,
    modelName,
    modificationName,
    label: asString(row.label) || [brandName, modelName, modificationName].filter(Boolean).join(' ') || 'Прибор',
    notes: '',
    warranty: mapWarranty(row.warranty),
    latestOrder: row.latest_order ? mapRepair(row.latest_order) : (repairs[0] ?? null),
    repairs: repairs.filter((item): item is DeviceRepair => Boolean(item)),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function toSearchItem(device: Device): DeviceSearchItem {
  return {
    id: device.id,
    serialNumber: device.serialNumber,
    label: device.label,
    groupName: device.groupName,
    brandName: device.brandName,
    modelName: device.modelName,
  }
}

function mapListItem(row: DeviceListItemRow): Device {
  const status = isWarrantyStatus(row.warranty_status) ? row.warranty_status : null

  return {
    id: row.id,
    serialNumber: row.serial_number,
    groupId: row.group_id,
    brandId: row.brand_id,
    modelId: row.model_id,
    modificationId: row.modification_id,
    groupName: row.group_name,
    brandName: row.brand_name,
    modelName: row.model_name,
    modificationName: row.modification_name,
    label: row.label || 'Прибор',
    notes: row.notes,
    warranty:
      row.warranty_id && row.warranty_start && row.warranty_end && status
        ? {
            id: row.warranty_id,
            startsOn: row.warranty_start,
            endsOn: row.warranty_end,
            status,
            orderId: null,
            orderNumber: '',
          }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function readHint(error: unknown) {
  if (typeof error === 'object' && error !== null && 'hint' in error && typeof error.hint === 'string') {
    return error.hint
  }
  return ''
}

export type DeviceListResult = {
  items: Device[]
  total: number
}

export async function listDevices(search: string, page: number, pageSize: number): Promise<DeviceListResult> {
  const supabase = getSupabase()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let query = supabase
    .from('device_list_items')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false })

  const term = sanitizeSearch(search)
  if (term) {
    query = query.or(
      `serial_number.ilike.%${term}%,label.ilike.%${term}%,brand_name.ilike.%${term}%,model_name.ilike.%${term}%`,
    )
  }

  const { data, error, count } = await query.range(from, to)
  if (error) {
    throw toAppError(error, 'Не удалось загрузить приборы.')
  }

  return {
    items: (data ?? []).map(mapListItem),
    total: count ?? 0,
  }
}

export async function searchDeviceSerial(queryText: string): Promise<SerialSearchResult> {
  const term = queryText.trim()
  if (term.length < SERIAL_LOOKUP_MIN_LENGTH) {
    const listed = await listDevices(term, 1, DEVICE_PAGE_SIZE)
    return {
      kind: 'list',
      device: null,
      items: listed.items.map(toSearchItem),
    }
  }

  const { data, error } = await getSupabase().rpc('search_device_serial', { serial_query: term })
  if (error) {
    throw toAppError(error, 'Не удалось найти прибор.')
  }

  const payload = asRecord(data)
  const kind = asString(payload?.kind, 'empty')
  const itemsRaw = payload?.items
  const items = Array.isArray(itemsRaw)
    ? itemsRaw.flatMap((item) => {
        const row = asRecord(item)
        if (!row?.id) {
          return []
        }
        return [
          {
            id: asString(row.id),
            serialNumber: asString(row.serial_number),
            label: asString(row.label) || 'Прибор',
            groupName: asString(row.group_name),
            brandName: asString(row.brand_name),
            modelName: asString(row.model_name),
          },
        ]
      })
    : []

  return {
    kind: kind === 'exact' || kind === 'list' ? kind : 'empty',
    device: mapLookup(payload?.device ?? null),
    items,
  }
}

export async function getDevice(id: string): Promise<Device | null> {
  const card = await getDeviceCard(id)
  return card?.device ?? null
}

export async function getDeviceCard(id: string): Promise<DeviceCard | null> {
  const { data, error } = await getSupabase().rpc('get_device_card', { target_device_id: id })
  if (error) {
    throw toAppError(error, 'Не удалось загрузить прибор.')
  }

  const payload = asRecord(data)
  const device = mapLookup(payload?.device ?? null)
  if (!device) {
    return null
  }

  const warranties = Array.isArray(payload?.warranties)
    ? payload.warranties.flatMap((item) => {
        const warranty = mapWarranty(item)
        return warranty ? [warranty] : []
      })
    : []

  return { device, warranties }
}

export async function createDevice(input: DeviceInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_device', {
    device_serial: input.serialNumber,
    device_customer_id: input.customerId,
    device_group_id: input.groupId,
    device_brand_id: input.brandId,
    device_model_id: input.modelId,
    device_modification_id: input.modificationId,
  })

  if (error) {
    const message = typeof error.message === 'string' ? error.message : ''
    if (message.includes('уже существует')) {
      throw new DeviceDuplicateError(readHint(error) || null, error)
    }
    throw toAppError(error, 'Не удалось создать прибор.')
  }

  return data
}

export async function updateDevice(input: UpdateDeviceInput): Promise<void> {
  const { error } = await getSupabase().rpc('update_device', {
    target_device_id: input.deviceId,
    device_group_id: input.groupId,
    device_brand_id: input.brandId,
    device_model_id: input.modelId,
    device_modification_id: input.modificationId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить прибор.')
  }
}

export async function deleteDevice(deviceId: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_device', {
    target_device_id: deviceId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить прибор.')
  }
}

export async function getWarrantyDefaults(): Promise<WarrantyDefaults> {
  const { data, error } = await getSupabase().rpc('get_warranty_defaults')
  if (error) {
    throw toAppError(error, 'Не удалось получить срок гарантии.')
  }

  const row = data?.[0]
  if (!row) {
    throw toAppError({ message: 'Не задан срок гарантии.' }, 'Не задан срок гарантии.')
  }

  return {
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    defaultMonths: row.default_months,
  }
}
