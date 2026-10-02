import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  getCompanyLogoUrl,
  removeCompanyLogo,
  uploadCompanyLogo,
} from '../services/company-logo-service'

export function useCompanyLogo(enabled = true) {
  return useQuery({
    queryKey: queryKeys.settings.companyLogo,
    queryFn: getCompanyLogoUrl,
    enabled,
    staleTime: 60_000,
  })
}

export function useUploadCompanyLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadCompanyLogo(file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.companyLogo })
    },
  })
}

export function useRemoveCompanyLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => removeCompanyLogo(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.companyLogo })
    },
  })
}
