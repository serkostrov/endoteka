import { useMutation, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import { inviteEmployee } from '../services/invite-service'
import { deleteUserAccount, updateUserAccount } from '../services/users-service'

export function useInviteEmployee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: inviteEmployee,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
    },
  })
}

export function useUpdateUserAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateUserAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.employees.active })
    },
  })
}

export function useDeleteUserAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteUserAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.employees.active })
    },
  })
}
