import { AppError, toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'

type InviteUserInput = {
  email: string
  fullName: string
  roleId: string
}

export async function inviteEmployee(input: InviteUserInput): Promise<void> {
  const { data, error } = await getSupabase().functions.invoke('invite-user', {
    body: {
      email: input.email,
      fullName: input.fullName,
      roleId: input.roleId,
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })

  if (error) {
    throw toAppError(error, 'Не удалось отправить приглашение.')
  }

  if (isRecord(data) && typeof data.error === 'string') {
    throw new AppError('INVITE', data.error)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
