import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  addDeviceCompatiblePart,
  deleteDeviceCompatiblePartGroup,
  listDeviceCompatiblePartGroups,
  listDeviceCompatibleParts,
  listInventoryItemCompatibleTypes,
  removeDeviceCompatiblePart,
  reorderDeviceCompatiblePartGroups,
  reorderDeviceCompatibleParts,
  upsertDeviceCompatiblePartGroup,
} from '../services/compatible-parts-service'

async function invalidateCompatibleLinks(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['devices', 'compatible-parts'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.devices.compatiblePartGroups() }),
    queryClient.invalidateQueries({ queryKey: ['devices', 'compatible-part-groups'] }),
    queryClient.invalidateQueries({ queryKey: ['inventory', 'compatible-types'] }),
  ])
}

export function useDeviceCompatibleParts(referenceItemId: string | null) {
  return useQuery({
    queryKey: queryKeys.devices.compatibleParts(referenceItemId ?? ''),
    queryFn: () => listDeviceCompatibleParts(referenceItemId!),
    enabled: Boolean(referenceItemId),
  })
}

/** Глобальный список групп. referenceItemId влияет только на partCount. */
export function useDeviceCompatiblePartGroups(referenceItemId?: string | null) {
  return useQuery({
    queryKey: queryKeys.devices.compatiblePartGroups(referenceItemId),
    queryFn: () => listDeviceCompatiblePartGroups(referenceItemId),
  })
}

export function useInventoryItemCompatibleTypes(itemId: string | null) {
  return useQuery({
    queryKey: queryKeys.inventory.compatibleTypes(itemId ?? ''),
    queryFn: () => listInventoryItemCompatibleTypes(itemId!),
    enabled: Boolean(itemId),
  })
}

export function useAddDeviceCompatiblePart(referenceItemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ itemId, groupId }: { itemId: string; groupId?: string | null }) =>
      addDeviceCompatiblePart(referenceItemId, itemId, groupId),
    onSuccess: async () => {
      await invalidateCompatibleLinks(queryClient)
    },
  })
}

export function useRemoveDeviceCompatiblePart(referenceItemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (itemId: string) => removeDeviceCompatiblePart(referenceItemId, itemId),
    onSuccess: async () => {
      await invalidateCompatibleLinks(queryClient)
    },
  })
}

export function useUpsertDeviceCompatiblePartGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { id?: string; name: string; color: string }) =>
      upsertDeviceCompatiblePartGroup(input),
    onSuccess: async () => {
      await invalidateCompatibleLinks(queryClient)
    },
  })
}

export function useDeleteDeviceCompatiblePartGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (groupId: string) => deleteDeviceCompatiblePartGroup(groupId),
    onSuccess: async () => {
      await invalidateCompatibleLinks(queryClient)
    },
  })
}

export function useReorderDeviceCompatiblePartGroups() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (groupIds: string[]) => reorderDeviceCompatiblePartGroups(groupIds),
    onSuccess: async () => {
      await invalidateCompatibleLinks(queryClient)
    },
  })
}

export function useReorderDeviceCompatibleParts(referenceItemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ groupId, linkIds }: { groupId: string; linkIds: string[] }) =>
      reorderDeviceCompatibleParts(referenceItemId, groupId, linkIds),
    onSuccess: async () => {
      await invalidateCompatibleLinks(queryClient)
    },
  })
}

/** Связь со стороны номенклатуры: выбрать вид прибора. */
export function useLinkInventoryItemCompatibleType(itemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (referenceItemId: string) => addDeviceCompatiblePart(referenceItemId, itemId),
    onSuccess: async () => {
      await invalidateCompatibleLinks(queryClient)
    },
  })
}

export function useUnlinkInventoryItemCompatibleType(itemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (referenceItemId: string) => removeDeviceCompatiblePart(referenceItemId, itemId),
    onSuccess: async () => {
      await invalidateCompatibleLinks(queryClient)
    },
  })
}
