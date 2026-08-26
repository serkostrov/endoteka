import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { DocumentKind, DocumentPageSize, DocumentSourceType } from '@/lib/constants/documents'
import { queryKeys } from '@/lib/query-keys'

import {
  createDocument,
  createDocumentTemplate,
  deleteDocumentTemplate,
  getDocument,
  getDocumentContext,
  getDocumentTemplate,
  issueDocument,
  listDocuments,
  listDocumentTemplates,
  updateDocumentTemplate,
} from '../services/documents-service'
import type { TemplateBlock } from '../template-schema'

export function useDocumentTemplates(kind: string, search: string) {
  return useQuery({
    queryKey: queryKeys.documents.templates({ kind, search }),
    queryFn: () => listDocumentTemplates(kind, search),
    placeholderData: keepPreviousData,
  })
}

export function useDocumentTemplate(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.documents.template(id) : queryKeys.documents.all,
    queryFn: () => getDocumentTemplate(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useDocuments(input: {
  search: string
  kind: string
  sourceType?: string
  sourceId?: string | null
  page: number
  pageSize: number
}) {
  return useQuery({
    queryKey: queryKeys.documents.list(input),
    queryFn: () => listDocuments(input),
    placeholderData: keepPreviousData,
  })
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.documents.detail(id) : queryKeys.documents.all,
    queryFn: () => getDocument(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useDocumentContext(sourceType: DocumentSourceType, sourceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.documents.context(sourceType, sourceId ?? ''),
    queryFn: () => getDocumentContext(sourceType, sourceId),
    enabled,
  })
}

function invalidateDocuments(queryClient: ReturnType<typeof useQueryClient>, documentId?: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.documents.all }),
    documentId ? queryClient.invalidateQueries({ queryKey: queryKeys.documents.detail(documentId) }) : Promise.resolve(),
  ])
}

export function useCreateDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { templateId: string; sourceType: DocumentSourceType; sourceId: string | null }) =>
      createDocument(input),
    onSuccess: async (id) => {
      await invalidateDocuments(queryClient, id)
    },
  })
}

export function useIssueDocument(documentId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => issueDocument(documentId),
    onSuccess: async () => {
      await invalidateDocuments(queryClient, documentId)
    },
  })
}

export function useCreateDocumentTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { name: string; kind: DocumentKind; pageSize: DocumentPageSize; body: TemplateBlock[] }) =>
      createDocumentTemplate(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents.all })
    },
  })
}

export function useUpdateDocumentTemplate(templateId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { name: string; kind: DocumentKind; pageSize: DocumentPageSize; body: TemplateBlock[] }) =>
      updateDocumentTemplate({ id: templateId, ...input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents.template(templateId) })
    },
  })
}

export function useDeleteDocumentTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteDocumentTemplate(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents.all })
    },
  })
}
