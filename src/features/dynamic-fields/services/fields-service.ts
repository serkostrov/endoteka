import {
  defaultFieldLayout,
  isFieldLayoutHeight,
  isFieldLayoutWidth,
  isFieldType,
  type FieldLayoutHeight,
  type FieldLayoutWidth,
  type FieldType,
} from '@/lib/constants/fields'
import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { DynamicFieldOptionRow, DynamicFieldRow, FieldEntitySummaryRow, Json } from '@/types/database'

export type FieldTypeRecord = {
  code: FieldType
  name: string
}

export type FieldEntitySummary = {
  code: string
  name: string
  description: string | null
  sortOrder: number
  fieldCount: number
  activeFieldCount: number
}

export type DynamicFieldOption = {
  id: string
  code: string
  label: string
  sortOrder: number
  isActive: boolean
}

export type DynamicFieldDefinition = {
  id: string
  entityCode: string
  code: string
  name: string
  fieldType: FieldType
  isRequired: boolean
  isActive: boolean
  sortOrder: number
  groupName: string
  layoutWidth: FieldLayoutWidth
  layoutHeight: FieldLayoutHeight
  createdAt: string
  updatedAt: string
  options: DynamicFieldOption[]
}

export type DynamicFieldInput = {
  id?: string
  entityCode: string
  code: string
  name: string
  fieldType: FieldType
  isRequired: boolean
  groupName?: string
  layoutWidth?: FieldLayoutWidth
  layoutHeight?: FieldLayoutHeight
  options: { code: string; label: string; isActive: boolean; sortOrder: number }[]
}

export type DynamicFieldValueData = string | number | boolean | null

function mapEntity(row: FieldEntitySummaryRow): FieldEntitySummary {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    fieldCount: row.field_count,
    activeFieldCount: row.active_field_count,
  }
}

function mapOption(row: DynamicFieldOptionRow): DynamicFieldOption {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapField(row: DynamicFieldRow, options: DynamicFieldOption[]): DynamicFieldDefinition | null {
  if (!isFieldType(row.field_type)) {
    return null
  }

  const fallback = defaultFieldLayout(row.field_type)

  return {
    id: row.id,
    entityCode: row.entity_code,
    code: row.code,
    name: row.name,
    fieldType: row.field_type,
    isRequired: row.is_required,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    groupName: row.group_name,
    layoutWidth: isFieldLayoutWidth(row.layout_width) ? row.layout_width : fallback.width,
    layoutHeight: isFieldLayoutHeight(row.layout_height) ? row.layout_height : fallback.height,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    options,
  }
}

export async function listFieldTypes(): Promise<FieldTypeRecord[]> {
  const { data, error } = await getSupabase()
    .from('dynamic_field_types')
    .select('code, name')
    .order('sort_order')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить типы полей.')
  }

  return (data ?? []).flatMap((row) => (isFieldType(row.code) ? [{ code: row.code, name: row.name }] : []))
}

export async function listFieldEntities(): Promise<FieldEntitySummary[]> {
  const { data, error } = await getSupabase()
    .from('field_entity_summaries')
    .select('*')
    .order('sort_order')
    .order('name')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить разделы полей.')
  }

  return (data ?? []).map(mapEntity)
}

export async function listDynamicFields(entityCode: string): Promise<DynamicFieldDefinition[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('dynamic_fields')
    .select('*')
    .eq('entity_code', entityCode)
    .order('sort_order')
    .order('name')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить поля.')
  }

  const fields = data ?? []
  if (fields.length === 0) {
    return []
  }

  const { data: optionRows, error: optionsError } = await supabase
    .from('dynamic_field_options')
    .select('*')
    .in(
      'field_id',
      fields.map((field) => field.id),
    )
    .order('sort_order')

  if (optionsError) {
    throw toAppError(optionsError, 'Не удалось загрузить варианты полей.')
  }

  const optionsByField = new Map<string, DynamicFieldOption[]>()
  for (const option of optionRows ?? []) {
    const list = optionsByField.get(option.field_id) ?? []
    list.push(mapOption(option))
    optionsByField.set(option.field_id, list)
  }

  return fields.flatMap((field) => {
    const mapped = mapField(field, optionsByField.get(field.id) ?? [])
    return mapped ? [mapped] : []
  })
}

export async function getDynamicFieldUsage(fieldId: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('dynamic_field_usage_count', {
    target_field_id: fieldId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось проверить использование поля.')
  }

  return data ?? 0
}

export async function upsertDynamicField(input: DynamicFieldInput): Promise<void> {
  const { error } = await getSupabase().rpc('upsert_dynamic_field', {
    target_id: input.id ?? null,
    entity_code: input.entityCode,
    field_code: input.code,
    field_name: input.name,
    field_type: input.fieldType,
    is_required: input.isRequired,
    options: input.options as unknown as Json,
    group_name: input.groupName ?? '',
    layout_width: input.layoutWidth ?? defaultFieldLayout(input.fieldType).width,
    layout_height: input.layoutHeight ?? defaultFieldLayout(input.fieldType).height,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить поле.')
  }
}

export async function setDynamicFieldLayout(
  fieldId: string,
  layoutWidth: FieldLayoutWidth,
  layoutHeight: FieldLayoutHeight,
): Promise<void> {
  const { error } = await getSupabase().rpc('set_dynamic_field_layout', {
    target_id: fieldId,
    next_width: layoutWidth,
    next_height: layoutHeight,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить размер поля.')
  }
}

export async function setDynamicFieldActive(fieldId: string, isActive: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('set_dynamic_field_active', {
    target_id: fieldId,
    next_active: isActive,
  })

  if (error) {
    throw toAppError(error, 'Не удалось изменить статус поля.')
  }
}

export async function reorderDynamicFields(entityCode: string, fieldIds: string[]): Promise<void> {
  const { error } = await getSupabase().rpc('reorder_dynamic_fields', {
    target_entity_code: entityCode,
    field_ids: fieldIds,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить порядок полей.')
  }
}

export async function deleteDynamicField(fieldId: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_dynamic_field', {
    target_id: fieldId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить поле.')
  }
}

export async function saveDynamicFieldValues(
  entityCode: string,
  recordId: string,
  values: Record<string, DynamicFieldValueData>,
): Promise<void> {
  const payload: Record<string, Json> = {}
  for (const [key, value] of Object.entries(values)) {
    payload[key] = value
  }

  const { error } = await getSupabase().rpc('save_dynamic_field_values', {
    target_entity_code: entityCode,
    target_record_id: recordId,
    field_values: payload,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить значения полей.')
  }
}

export async function listDynamicFieldValues(
  entityCode: string,
  recordId: string,
): Promise<Record<string, DynamicFieldValueData>> {
  const supabase = getSupabase()
  const [fields, valuesResult] = await Promise.all([
    listDynamicFields(entityCode),
    supabase.from('dynamic_field_values').select('field_id, value').eq('entity_code', entityCode).eq('record_id', recordId),
  ])

  if (valuesResult.error) {
    throw toAppError(valuesResult.error, 'Не удалось загрузить значения полей.')
  }

  const byFieldId = new Map((valuesResult.data ?? []).map((row) => [row.field_id, parseFieldValue(row.value)]))
  const result: Record<string, DynamicFieldValueData> = {}

  for (const field of fields) {
    result[field.code] = byFieldId.get(field.id) ?? emptyStoredValue(field.fieldType)
  }

  return result
}

function parseFieldValue(value: Json): DynamicFieldValueData {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }

  return null
}

function emptyStoredValue(fieldType: string): DynamicFieldValueData {
  if (fieldType === 'number') {
    return null
  }
  if (fieldType === 'checkbox') {
    return false
  }
  return ''
}
