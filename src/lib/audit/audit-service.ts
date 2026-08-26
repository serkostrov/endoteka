import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { AuthAuditAction } from '@/types/audit'

export async function writeAuditEventSafe(action: AuthAuditAction): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('record_auth_event', { event_action: action })
    if (error) {
      throw toAppError(error, 'Не удалось записать событие аудита.')
    }
  } catch {
    console.error('Audit write failed')
  }
}
