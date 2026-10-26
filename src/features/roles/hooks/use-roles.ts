import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'
import type { Permission } from '@/lib/constants/permissions'

import {
  createRole,
  deleteRole,
  listAssignableRoles,
  listRolePermissionCodes,
  listRoles,
  saveRolePermissions,
  updateRole,
} from '../services/roles-service'

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

async function invalidateRoleLists(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.roles.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.roles.assignable }),
  ])
}

export function useCreateRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createRole,
    onSuccess: async () => {
      await invalidateRoleLists(queryClient)
    },
  })
}

export function useUpdateRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateRole,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        invalidateRoleLists(queryClient),
        queryClient.invalidateQueries({ queryKey: queryKeys.roles.detail(variables.id) }),
      ])
    },
  })
}

export function useDeleteRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteRole,
    onSuccess: async (_data, roleId) => {
      await Promise.all([
        invalidateRoleLists(queryClient),
        queryClient.removeQueries({ queryKey: queryKeys.roles.detail(roleId) }),
      ])
    },
  })
}
