import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import { invokeEdgeFunction } from '@/lib/supabase/invoke-function'
import type { UserAccountRow } from '@/types/database'

export type UserAccount = {
  id: string
  fullName: string
  email: string
  isActive: boolean
  roleId: string | null
  roleCode: string | null
  roleName: string | null
  createdAt: string
  updatedAt: string
}

export type UserListFilters = {
  search: string
  roleId: string
  status: 'all' | 'active' | 'inactive'
  page: number
  pageSize: number
}

export type UserListResult = {
  items: UserAccount[]
  total: number
}

function mapUserAccount(row: UserAccountRow): UserAccount {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    isActive: row.is_active,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function sanitizeSearch(value: string) {
  return value.replace(/[%_,]/g, '').trim()
}

export async function listUsers(filters: UserListFilters): Promise<UserListResult> {
  const supabase = getSupabase()
  const from = (filters.page - 1) * filters.pageSize
  const to = from + filters.pageSize - 1
  let query = supabase
    .from('user_accounts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  const search = sanitizeSearch(filters.search)
  if (search) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
  }

  if (filters.roleId !== 'all') {
    query = query.eq('role_id', filters.roleId)
  }

  if (filters.status === 'active') {
    query = query.eq('is_active', true)
  }

  if (filters.status === 'inactive') {
    query = query.eq('is_active', false)
  }

  const { data, error, count } = await query.range(from, to)

  if (error) {
    throw toAppError(error, 'Не удалось загрузить список сотрудников.')
  }

  return {
    items: (data ?? []).map(mapUserAccount),
    total: count ?? 0,
  }
}

export type ActiveEmployee = {
  id: string
  fullName: string
  email: string
}

export async function listActiveEmployees(): Promise<ActiveEmployee[]> {
  const { data, error } = await getSupabase().rpc('list_active_employees')

  if (error) {
    throw toAppError(error, 'Не удалось загрузить список сотрудников.')
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name || row.email,
    email: row.email,
  }))
}

export async function updateUserAccount(input: {
  userId: string
  fullName: string
  roleId: string
  isActive: boolean
  password?: string
}): Promise<void> {
  const { error } = await getSupabase().rpc('update_user_account', {
    target_user_id: input.userId,
    next_full_name: input.fullName,
    target_role_id: input.roleId,
    next_active: input.isActive,
  })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить сотрудника.')
  }

  const password = input.password?.trim() ?? ''
  if (!password) {
    return
  }

  await invokeEdgeFunction(
    'set-user-password',
    { userId: input.userId, password },
    'Не удалось изменить пароль.',
  )
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await invokeEdgeFunction('delete-user', { userId }, 'Не удалось удалить пользователя.')
}
