import { AppError, toAppError } from '@/lib/errors'
import { writeAuditEventSafe } from '@/lib/audit/audit-service'
import { getSupabase } from '@/lib/supabase/client'
import type { AuthUser } from '@/types/auth'

import { parsePermissions, parseRoles } from '../permissions'

function isActiveProfile(value: { is_active: boolean } | null): value is { is_active: boolean } {
  return value !== null
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password })

  if (error) {
    throw toAppError(error, 'Не удалось войти.')
  }

  await writeAuditEventSafe('auth.signed_in')
}

export async function signOut(): Promise<void> {
  await writeAuditEventSafe('auth.signed_out')

  const { error } = await getSupabase().auth.signOut()

  if (error) {
    throw toAppError(error, 'Не удалось выйти из системы.')
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = getSupabase()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw toAppError(userError, 'Не удалось проверить сессию.')
  }

  if (!user) {
    return null
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    throw toAppError(profileError, 'Не удалось загрузить профиль пользователя.')
  }

  if (!isActiveProfile(profile)) {
    await supabase.auth.signOut()
    throw new AppError('PROFILE_MISSING', 'Профиль пользователя не найден. Обратитесь к администратору.')
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    throw new AppError('ACCOUNT_DISABLED', 'Учётная запись отключена. Обратитесь к администратору.')
  }

  const [{ data: roleRows, error: rolesError }, { data: permissionRows, error: permissionsError }] =
    await Promise.all([
      supabase.rpc('get_my_roles'),
      supabase.rpc('get_my_permissions'),
    ])

  if (rolesError) {
    throw toAppError(rolesError, 'Не удалось загрузить роли пользователя.')
  }

  if (permissionsError) {
    throw toAppError(permissionsError, 'Не удалось загрузить права пользователя.')
  }

  return {
    id: user.id,
    email: profile.email || user.email || '',
    fullName: profile.full_name,
    isActive: profile.is_active,
    roles: parseRoles((roleRows ?? []).map((row) => row.code)),
    permissions: parsePermissions((permissionRows ?? []).map((row) => row.code)),
  }
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password })

  if (error) {
    throw toAppError(error, 'Не удалось сохранить пароль.')
  }

  await writeAuditEventSafe('auth.password_updated')
}

export function waitForSession(timeoutMs = 10_000): Promise<boolean> {
  const supabase = getSupabase()

  return new Promise((resolve) => {
    let settled = false

    const finish = (value: boolean) => {
      if (settled) {
        return
      }

      settled = true
      window.clearTimeout(timeoutId)
      subscription.unsubscribe()
      resolve(value)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        finish(true)
      }
    })

    const timeoutId = window.setTimeout(() => finish(false), timeoutMs)

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        finish(true)
      }
    })
  })
}
