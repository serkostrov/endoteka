import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  deleteReferenceItemPhoto,
  listReferenceItemPhotos,
  setReferenceItemPhotoCover,
  uploadReferenceItemPhoto,
} from '../services/reference-item-photos-service'

export function useReferenceItemPhotos(referenceItemId: string | undefined) {
  return useQuery({
    queryKey: referenceItemId
      ? queryKeys.devices.itemPhotos(referenceItemId)
      : queryKeys.devices.all,
    queryFn: () => listReferenceItemPhotos(referenceItemId ?? ''),
    enabled: Boolean(referenceItemId),
  })
}

export function useUploadReferenceItemPhoto(referenceItemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => uploadReferenceItemPhoto(referenceItemId, file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.devices.itemPhotos(referenceItemId),
      })
    },
  })
}

export function useDeleteReferenceItemPhoto(referenceItemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { id: string; filePath: string | null }) =>
      deleteReferenceItemPhoto(input.id, input.filePath),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.devices.itemPhotos(referenceItemId),
      })
    },
  })
}

export function useSetReferenceItemPhotoCover(referenceItemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (photoId: string) => setReferenceItemPhotoCover(photoId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.devices.itemPhotos(referenceItemId),
      })
    },
  })
}
