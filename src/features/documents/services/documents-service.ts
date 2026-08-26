import { isDocumentKind, isDocumentPageSize, isDocumentSourceType, isDocumentStatus, type DocumentKind, type DocumentPageSize, type DocumentSourceType, type DocumentStatus } from '@/lib/constants/documents'
import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

import {
  parseDocumentContext,
  parseTemplateBody,
  type DocumentContext,
  type TemplateBlock,
} from '../template-schema'

export type DocumentTemplateListItem = {
  id: string
  code: string
  name: string
  kind: DocumentKind
  pageSize: DocumentPageSize
  isSystem: boolean
  updatedAt: string
}

export type DocumentTemplate = DocumentTemplateListItem & {
  body: TemplateBlock[]
  createdAt: string
}

export type DocumentListItem = {
  id: string
  number: string
  title: string
  kind: DocumentKind
  sourceType: DocumentSourceType
  sourceId: string | null
  sourceLabel: string
  status: DocumentStatus
  createdByName: string
  createdAt: string
  issuedAt: string | null
}

export type DocumentRecord = DocumentListItem & {
  templateId: string
  templateName: string
  pageSize: DocumentPageSize
  body: TemplateBlock[]
  context: DocumentContext
  createdBy: string | null
}

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value
}

function asString(value: Json | undefined, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function mapKind(value: string): DocumentKind {
  return isDocumentKind(value) ? value : 'custom'
}

function mapStatus(value: string): DocumentStatus {
  return isDocumentStatus(value) ? value : 'draft'
}

function mapSourceType(value: string): DocumentSourceType {
  return isDocumentSourceType(value) ? value : 'none'
}

function mapPageSize(value: string): DocumentPageSize {
  return isDocumentPageSize(value) ? value : 'a4'
}

export async function listDocumentTemplates(kind: string, search: string) {
  const { data, error } = await getSupabase().rpc('list_document_templates', {
    kind_filter: kind === 'all' ? '' : kind,
    search_query: search,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить шаблоны.')
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: mapKind(row.kind),
    pageSize: mapPageSize(row.page_size),
    isSystem: row.is_system,
    updatedAt: row.updated_at,
  }))
}

export async function getDocumentTemplate(id: string): Promise<DocumentTemplate> {
  const { data, error } = await getSupabase().rpc('get_document_template', {
    target_template_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить шаблон.')
  }

  const row = asRecord(data)
  if (!row || typeof row.id !== 'string') {
    throw toAppError(new Error('Шаблон не найден.'), 'Шаблон не найден.')
  }

  return {
    id: row.id,
    code: asString(row.code),
    name: asString(row.name),
    kind: mapKind(asString(row.kind, 'custom')),
    pageSize: mapPageSize(asString(row.page_size, 'a4')),
    isSystem: row.is_system === true,
    updatedAt: asString(row.updated_at),
    createdAt: asString(row.created_at),
    body: parseTemplateBody(row.body),
  }
}

export async function createDocumentTemplate(input: {
  name: string
  kind: DocumentKind
  pageSize: DocumentPageSize
  body: TemplateBlock[]
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_document_template', {
    template_name: input.name,
    template_kind: input.kind,
    template_page_size: input.pageSize,
    template_body: input.body as unknown as Json,
  })

  if (error) {
    throw toAppError(error, 'Не удалось создать шаблон.')
  }

  return data
}

export async function updateDocumentTemplate(input: {
  id: string
  name: string
  kind: DocumentKind
  pageSize: DocumentPageSize
  body: TemplateBlock[]
}): Promise<void> {
  const { error } = await getSupabase().rpc('update_document_template', {
    target_template_id: input.id,
    template_name: input.name,
    template_kind: input.kind,
    template_page_size: input.pageSize,
    template_body: input.body as unknown as Json,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить шаблон.')
  }
}

export async function deleteDocumentTemplate(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_document_template', {
    target_template_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить шаблон.')
  }
}

export async function listDocuments(input: {
  search: string
  kind: string
  sourceType?: string
  sourceId?: string | null
  page: number
  pageSize: number
}) {
  const { data, error } = await getSupabase().rpc('list_documents', {
    search_query: input.search,
    kind_filter: input.kind === 'all' ? '' : input.kind,
    source_type_filter: input.sourceType && input.sourceType !== 'all' ? input.sourceType : '',
    source_id_filter: input.sourceId ?? null,
    page_number: input.page,
    page_size: input.pageSize,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить документы.')
  }

  const rows = data ?? []
  return {
    items: rows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      kind: mapKind(row.kind),
      sourceType: mapSourceType(row.source_type),
      sourceId: row.source_id,
      sourceLabel: row.source_label,
      status: mapStatus(row.status),
      createdByName: row.created_by_name,
      createdAt: row.created_at,
      issuedAt: row.issued_at,
    })),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

export async function getDocument(id: string): Promise<DocumentRecord> {
  const { data, error } = await getSupabase().rpc('get_document', {
    target_document_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить документ.')
  }

  const row = asRecord(data)
  if (!row || typeof row.id !== 'string') {
    throw toAppError(new Error('Документ не найден.'), 'Документ не найден.')
  }

  return {
    id: row.id,
    number: asString(row.number),
    title: asString(row.title),
    kind: mapKind(asString(row.kind, 'custom')),
    sourceType: mapSourceType(asString(row.source_type, 'none')),
    sourceId: typeof row.source_id === 'string' ? row.source_id : null,
    sourceLabel: asString(row.source_label),
    status: mapStatus(asString(row.status, 'draft')),
    createdByName: asString(row.created_by_name),
    createdAt: asString(row.created_at),
    issuedAt: typeof row.issued_at === 'string' ? row.issued_at : null,
    templateId: asString(row.template_id),
    templateName: asString(row.template_name),
    pageSize: mapPageSize(asString(row.page_size, 'a4')),
    body: parseTemplateBody(row.body),
    context: parseDocumentContext(row.context),
    createdBy: typeof row.created_by === 'string' ? row.created_by : null,
  }
}

export async function createDocument(input: {
  templateId: string
  sourceType: DocumentSourceType
  sourceId: string | null
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_document', {
    target_template_id: input.templateId,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось создать документ.')
  }

  return data
}

export async function issueDocument(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('issue_document', {
    target_document_id: id,
  })

  if (error) {
    throw toAppError(error, 'Не удалось выпустить документ.')
  }
}

export async function getDocumentContext(sourceType: DocumentSourceType, sourceId: string | null) {
  const { data, error } = await getSupabase().rpc('get_document_context', {
    p_source_type: sourceType,
    p_source_id: sourceId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось загрузить данные для шаблона.')
  }

  return parseDocumentContext(data)
}
