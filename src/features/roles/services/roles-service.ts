import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Permission } from '@/lib/constants/permissions'

export type RoleRecord = {
  id: string
  code: string
  name: string
  description: string | null
}

export async function listRoles(): Promise<RoleRecord[]> {
  const { data, error } = await getSupabase().from('roles').select('id, code, name, description').order('name')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить роли.')
  }

  return data ?? []
}

export async function listAssignableRoles(): Promise<RoleRecord[]> {
  const { data, error } = await getSupabase().rpc('get_assignable_roles')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить доступные роли.')
  }

  return data ?? []
}

export async function listRolePermissionCodes(roleId: string): Promise<Permission[]> {
  const supabase = getSupabase()
  const { data: links, error: linksError } = await supabase
    .from('role_permissions')
    .select('permission_id')
    .eq('role_id', roleId)

  if (linksError) {
    throw toAppError(linksError, 'Не удалось загрузить права роли.')
  }

  const { data: permissions, error } = await supabase.from('permissions').select('id, code')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить права.')
  }

  const assigned = new Set((links ?? []).map((link) => link.permission_id))
  return (permissions ?? [])
    .filter((permission) => assigned.has(permission.id))
    .map((permission) => permission.code as Permission)
}

export async function saveRolePermissions(roleId: string, permissionCodes: Permission[]): Promise<void> {
  const { error } = await getSupabase().rpc('set_role_permissions', {
    target_role_id: roleId,
    permission_codes: permissionCodes,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить матрицу прав.')
  }
}
