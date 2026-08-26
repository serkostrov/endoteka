import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  getReferenceItemUsage,
  listReferenceItems,
  listReferenceItemsBySetCode,
  listReferenceSets,
  reorderReferenceItems,
  setReferenceItemActive,
  upsertReferenceItem,
  deleteReferenceItem,
  type ReferenceItemInput,
} from '../services/references-service'

export function useReferenceSets() {
  return useQuery({
    queryKey: queryKeys.references.sets,
    queryFn: listReferenceSets,
  })
}

export function useReferenceItems(setId: string | undefined) {
  return useQuery({
    queryKey: setId ? queryKeys.references.items(setId) : queryKeys.references.sets,
    queryFn: () => listReferenceItems(setId ?? ''),
    enabled: Boolean(setId),
  })
}

export function useReferenceItemsBySetCode(setCode: string | undefined) {
  return useQuery({
    queryKey: setCode ? queryKeys.references.itemsByCode(setCode) : queryKeys.references.sets,
    queryFn: () => listReferenceItemsBySetCode(setCode ?? ''),
    enabled: Boolean(setCode),
  })
}

export function useReferenceItemUsage(itemId: string | undefined) {
  return useQuery({
    queryKey: itemId ? queryKeys.references.itemUsage(itemId) : queryKeys.references.all,
    queryFn: () => getReferenceItemUsage(itemId ?? ''),
    enabled: Boolean(itemId),
  })
}

export function useUpsertReferenceItem(setId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ReferenceItemInput) => upsertReferenceItem(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.references.items(setId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.references.sets })
    },
  })
}

export function useSetReferenceItemActive(setId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ itemId, isActive }: { itemId: string; isActive: boolean }) =>
      setReferenceItemActive(itemId, isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.references.items(setId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.references.sets })
    },
  })
}

export function useReorderReferenceItems(setId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (itemIds: string[]) => reorderReferenceItems(setId, itemIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.references.items(setId) })
    },
  })
}

export function useDeleteReferenceItem(setId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (itemId: string) => deleteReferenceItem(itemId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.references.items(setId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.references.sets })
    },
  })
}
