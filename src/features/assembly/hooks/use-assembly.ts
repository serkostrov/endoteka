import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  addAssemblyAttachmentUrl,
  addAssemblyJournalNote,
  addAssemblyPart,
  deleteAssemblyAttachment,
  getAssembly,
  getAssemblyJournal,
  listAssemblies,
  listAssemblyAttachments,
  removeAssemblyPart,
  updateAssemblyPart,
  uploadAssemblyFile,
  type AssemblyListFilters,
} from '../services/assembly-service'

function invalidateAssembly(queryClient: ReturnType<typeof useQueryClient>, orderId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.detail(orderId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.journal(orderId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.attachments(orderId) })
}

export function useAssemblies(filters: AssemblyListFilters) {
  return useQuery({
    queryKey: queryKeys.assemblies.list(filters),
    queryFn: () => listAssemblies(filters),
  })
}

export function useAssembly(orderId: string | null) {
  return useQuery({
    queryKey: queryKeys.assemblies.detail(orderId ?? ''),
    queryFn: () => getAssembly(orderId!),
    enabled: Boolean(orderId),
  })
}

export function useAssemblyJournal(orderId: string | null) {
  return useQuery({
    queryKey: queryKeys.assemblies.journal(orderId ?? ''),
    queryFn: () => getAssemblyJournal(orderId!),
    enabled: Boolean(orderId),
  })
}

export function useAssemblyAttachments(orderId: string | null) {
  return useQuery({
    queryKey: queryKeys.assemblies.attachments(orderId ?? ''),
    queryFn: () => listAssemblyAttachments(orderId!),
    enabled: Boolean(orderId),
  })
}

export function useAddAssemblyPart(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; qtyRequired?: number; qtyCollected?: number; comment?: string }) =>
      addAssemblyPart(orderId, input),
    onSuccess: () => invalidateAssembly(queryClient, orderId),
  })
}

export function useUpdateAssemblyPart(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      partId: string
      name?: string
      qtyRequired?: number
      qtyCollected?: number
      comment?: string
    }) =>
      updateAssemblyPart(input.partId, {
        name: input.name,
        qtyRequired: input.qtyRequired,
        qtyCollected: input.qtyCollected,
        comment: input.comment,
      }),
    onSuccess: () => invalidateAssembly(queryClient, orderId),
  })
}

export function useRemoveAssemblyPart(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (partId: string) => removeAssemblyPart(partId),
    onSuccess: () => invalidateAssembly(queryClient, orderId),
  })
}

export function useAddAssemblyJournalNote(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => addAssemblyJournalNote(orderId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.journal(orderId) })
    },
  })
}

export function useUploadAssemblyFile(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { file: File; caption: string }) =>
      uploadAssemblyFile(orderId, input.file, input.caption),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.journal(orderId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.attachments(orderId) })
    },
  })
}

export function useAddAssemblyAttachmentUrl(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { url: string; caption?: string }) =>
      addAssemblyAttachmentUrl(orderId, input.url, input.caption ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.journal(orderId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.attachments(orderId) })
    },
  })
}

export function useDeleteAssemblyAttachment(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; filePath: string | null }) =>
      deleteAssemblyAttachment(input.id, input.filePath),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.journal(orderId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.assemblies.attachments(orderId) })
    },
  })
}
