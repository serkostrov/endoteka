import { invokeEdgeFunction } from '@/lib/supabase/invoke-function'

type InviteUserInput = {
  email: string
  fullName: string
  roleId: string
}

export async function inviteEmployee(input: InviteUserInput): Promise<void> {
  await invokeEdgeFunction(
    'invite-user',
    {
      email: input.email,
      fullName: input.fullName,
      roleId: input.roleId,
      redirectTo: `${window.location.origin}/auth/callback`,
    },
    'Не удалось отправить приглашение.',
  )
}
