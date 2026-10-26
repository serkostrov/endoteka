import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { Permission } from '@/lib/constants/permissions'

export type RoleRecord = {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
}

type RoleRow = {
  id: string
  code: string
  name: string
  description: string | null
  is_system: boolean
}

function mapRole(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
  }
}

export async function listRoles(): Promise<RoleRecord[]> {
  const { data, error } = await getSupabase()
    .from('roles')
    .select('id, code, name, description, is_system')
    .order('name')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить роли.')
  }

  return (data ?? []).map(mapRole)
}

export async function listAssignableRoles(): Promise<RoleRecord[]> {
  const { data, error } = await getSupabase().rpc('get_assignable_roles')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить доступные роли.')
  }

  return (data ?? []).map((row) =>
    mapRole({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      is_system: row.is_system,
    }),
  )
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

export async function createRole(input: {
  name: string
  description: string
  copyFromRoleId?: string
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_role', {
    p_name: input.name,
    p_description: input.description || null,
    p_copy_from_role_id: input.copyFromRoleId || null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось создать роль.')
  }

  if (!data) {
    throw toAppError({ message: 'Пустой ответ сервера.' }, 'Не удалось создать роль.')
  }

  return data
}

export async function updateRole(input: {
  id: string
  name: string
  description: string
}): Promise<void> {
  const { error } = await getSupabase().rpc('update_role', {
    p_role_id: input.id,
    p_name: input.name,
    p_description: input.description || null,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить роль.')
  }
}

export async function deleteRole(roleId: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_role', {
    p_role_id: roleId,
  })

  if (error) {
    throw toAppError(error, 'Не удалось удалить роль.')
  }
}
