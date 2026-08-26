import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'
import type { Permission } from '@/lib/constants/permissions'

import { listAssignableRoles, listRolePermissionCodes, listRoles, saveRolePermissions } from '../services/roles-service'

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles.all,
    queryFn: listRoles,
  })
}

export function useAssignableRoles(enabled = true) {
  return useQuery({
    queryKey: queryKeys.roles.assignable,
    queryFn: listAssignableRoles,
    enabled,
  })
}

export function useRolePermissions(roleId: string | undefined) {
  return useQuery({
    queryKey: roleId ? queryKeys.roles.detail(roleId) : queryKeys.roles.all,
    queryFn: () => listRolePermissionCodes(roleId ?? ''),
    enabled: Boolean(roleId),
  })
}

export function useSaveRolePermissions(roleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (permissionCodes: Permission[]) => saveRolePermissions(roleId, permissionCodes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.roles.detail(roleId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}
