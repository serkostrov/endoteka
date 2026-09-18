import type { Session } from '@supabase/supabase-js'

import { AppError, toAppError } from '@/lib/errors'
import { writeAuditEventSafe } from '@/lib/audit/audit-service'
import { getSupabase } from '@/lib/supabase/client'
import type { AuthUser } from '@/types/auth'

import {
  getSavedAccount,
  removeSavedAccount,
  updateSavedAccountProfile,
  upsertSavedAccount,
} from '../account-locker'
import { parsePermissions, parseRoles } from '../permissions'

function isActiveProfile(value: { is_active: boolean } | null): value is { is_active: boolean } {
  return value !== null
}

function isAuthSessionMissing(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes('auth session missing')
}

async function getSessionOrNull(): Promise<Session | null> {
  try {
    const { data, error } = await getSupabase().auth.getSession()
    if (error) {
      if (isAuthSessionMissing(error)) {
        return null
      }
      throw error
    }
    return data.session
  } catch (error) {
    if (isAuthSessionMissing(error)) {
      return null
    }
    throw error
  }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password })

  if (error) {
    throw toAppError(error, 'Не удалось войти.')
  }

  await persistAuthSession(data.session)
  await writeAuditEventSafe('auth.signed_in')
}

export async function persistAuthSession(session: Session | null, profile?: { email: string; fullName: string }) {
  if (!session?.access_token || !session.refresh_token || !session.user.id) {
    return
  }

  const email = profile?.email || session.user.email || ''
  const existing = getSavedAccount(session.user.id)
  const fullName = profile?.fullName || existing?.fullName || email

  upsertSavedAccount({
    userId: session.user.id,
    email,
    fullName,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
    lastUsedAt: new Date().toISOString(),
  })
}

export async function persistCurrentSession() {
  await persistAuthSession(await getSessionOrNull())
}

export async function signOut(options?: { forgetCurrent?: boolean }): Promise<void> {
  const supabase = getSupabase()
  const session = await getSessionOrNull()
  const userId = session?.user.id

  await writeAuditEventSafe('auth.signed_out')

  const { error } = await supabase.auth.signOut({ scope: 'local' })

  if (error) {
    throw toAppError(error, 'Не удалось выйти из системы.')
  }

  if (options?.forgetCurrent && userId) {
    removeSavedAccount(userId)
  }
}

export async function addAnotherAccount(): Promise<void> {
  await persistCurrentSession()
  const { error } = await getSupabase().auth.signOut({ scope: 'local' })
  if (error) {
    throw toAppError(error, 'Не удалось подготовить вход другой учётной записи.')
  }
}

export async function switchAccount(userId: string): Promise<void> {
  const supabase = getSupabase()
  const current = await getSessionOrNull()

  if (current?.user.id === userId) {
    return
  }

  if (current) {
    await persistAuthSession(current)
  }

  const account = getSavedAccount(userId)
  if (!account?.accessToken || !account.refreshToken) {
    if (account) {
      removeSavedAccount(userId)
    }
    throw new AppError('ACCOUNT_MISSING', 'Сохранённый вход повреждён. Войдите с паролем ещё раз.')
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
  })

  if (error || !data.session) {
    removeSavedAccount(userId)
    throw toAppError(error ?? { message: 'Auth session missing!' }, 'Сессия истекла. Войдите в эту учётную запись заново.')
  }

  await persistAuthSession(data.session, { email: account.email, fullName: account.fullName })
  await writeAuditEventSafe('auth.signed_in')
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = getSupabase()
  const session = await getSessionOrNull()
  if (!session?.user) {
    return null
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    if (isAuthSessionMissing(userError)) {
      return null
    }
    throw toAppError(userError, 'Не удалось проверить сессию.')
  }

  if (!user) {
    return null
  }

  const { data: profileWithAvatar, error: profileWithAvatarError } = await supabase
    .from('profiles')
    .select('id, full_name, email, is_active, avatar_path')
    .eq('id', user.id)
    .maybeSingle()

  let profile = profileWithAvatar
  let profileError = profileWithAvatarError

  if (profileError && /avatar_path|column/i.test(profileError.message)) {
    const fallback = await supabase
      .from('profiles')
      .select('id, full_name, email, is_active')
      .eq('id', user.id)
      .maybeSingle()
    profile = fallback.data
      ? { ...fallback.data, avatar_path: null }
      : null
    profileError = fallback.error
  }

  if (profileError) {
    throw toAppError(profileError, 'Не удалось загрузить профиль пользователя.')
  }

  if (!isActiveProfile(profile)) {
    removeSavedAccount(user.id)
    await supabase.auth.signOut({ scope: 'local' })
    throw new AppError('PROFILE_MISSING', 'Профиль пользователя не найден. Обратитесь к администратору.')
  }

  if (!profile.is_active) {
    removeSavedAccount(user.id)
    await supabase.auth.signOut({ scope: 'local' })
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

  const avatarUrl = publicAvatarUrl(profile.avatar_path ?? null)
  const currentUser: AuthUser = {
    id: user.id,
    email: profile.email || user.email || '',
    fullName: profile.full_name,
    isActive: profile.is_active,
    avatarUrl,
    roles: parseRoles((roleRows ?? []).map((row) => row.code)),
    permissions: parsePermissions((permissionRows ?? []).map((row) => row.code)),
  }

  updateSavedAccountProfile(currentUser.id, {
    email: currentUser.email,
    fullName: currentUser.fullName,
    avatarUrl: currentUser.avatarUrl,
  })

  return currentUser
}

const PROFILE_AVATARS_BUCKET = 'profile-avatars'
const PROFILE_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024

export function publicAvatarUrl(path: string | null | undefined): string | null {
  if (!path) {
    return null
  }
  try {
    const { data } = getSupabase().storage.from(PROFILE_AVATARS_BUCKET).getPublicUrl(path)
    return data.publicUrl || null
  } catch {
    return null
  }
}

function resolveAvatarMime(file: File): string | null {
  const type = file.type.trim().toLowerCase()
  if (PROFILE_AVATAR_MIME.includes(type)) {
    return type === 'image/jpg' ? 'image/jpeg' : type
  }
  const name = file.name.toLowerCase()
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (name.endsWith('.png')) {
    return 'image/png'
  }
  if (name.endsWith('.webp')) {
    return 'image/webp'
  }
  return null
}

export async function uploadMyAvatar(file: File): Promise<string> {
  const mime = resolveAvatarMime(file)
  if (!mime) {
    throw toAppError(
      { message: 'Можно загрузить только JPEG, PNG или WebP.' },
      'Можно загрузить только JPEG, PNG или WebP.',
    )
  }
  if (file.size > PROFILE_AVATAR_MAX_BYTES) {
    throw toAppError({ message: 'Фото больше 5 МБ.' }, 'Фото больше 5 МБ.')
  }

  const supabase = getSupabase()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    throw toAppError(userError, 'Нужна авторизация.')
  }

  const extension = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg'
  const path = `${user.id}/${crypto.randomUUID()}${extension}`
  const payload = new File([file], `avatar${extension}`, { type: mime })

  const { error: uploadError } = await supabase.storage.from(PROFILE_AVATARS_BUCKET).upload(path, payload, {
    contentType: mime,
    upsert: true,
    cacheControl: '3600',
  })
  if (uploadError) {
    throw toAppError(uploadError, 'Не удалось загрузить фото.')
  }

  const { data: oldPath, error } = await supabase.rpc('set_my_avatar', { file_path: path })
  if (error) {
    await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([path])
    throw toAppError(error, 'Не удалось сохранить аватар.')
  }

  if (oldPath) {
    await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([oldPath])
  }

  return publicAvatarUrl(path) ?? path
}

export async function removeMyAvatar(): Promise<void> {
  const supabase = getSupabase()
  const { data: oldPath, error } = await supabase.rpc('clear_my_avatar')
  if (error) {
    throw toAppError(error, 'Не удалось удалить аватар.')
  }
  if (oldPath) {
    await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([oldPath])
  }
}

export const PROFILE_AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp,image/jpg,.jpg,.jpeg,.png,.webp'

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
