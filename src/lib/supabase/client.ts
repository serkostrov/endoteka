import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { env } from '@/config/env'
import { AppError } from '@/lib/errors'
import type { Database } from '@/types/database'

let client: SupabaseClient<Database> | null = null

export function getSupabase(): SupabaseClient<Database> {
  if (!env.isConfigured) {
    throw new AppError('CONFIG', 'Приложение не настроено. Задайте переменные окружения Supabase.')
  }

  if (!client) {
    client = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }

  return client
}
