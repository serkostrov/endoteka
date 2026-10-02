import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  addDeviceCompatiblePart,
  listDeviceCompatibleParts,
  listInventoryItemCompatibleTypes,
  removeDeviceCompatiblePart,
} from '../services/compatible-parts-service'

async function invalidateCompatibleLinks(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['devices', 'compatible-parts'] }),
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
    mutationFn: (itemId: string) => addDeviceCompatiblePart(referenceItemId, itemId),
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
