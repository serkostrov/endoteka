import { z } from 'zod'

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
})

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return undefined
}

const runtime = typeof window === 'undefined' ? undefined : window.__ENDOTEKA_ENV__

const parsed = envSchema.safeParse({
  VITE_SUPABASE_URL: firstNonEmpty(runtime?.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_URL),
  VITE_SUPABASE_ANON_KEY: firstNonEmpty(runtime?.VITE_SUPABASE_ANON_KEY, import.meta.env.VITE_SUPABASE_ANON_KEY),
})

export const env = parsed.success
  ? {
      isConfigured: true as const,
      supabaseUrl: parsed.data.VITE_SUPABASE_URL,
      supabaseAnonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
    }
  : {
      isConfigured: false as const,
      supabaseUrl: '',
      supabaseAnonKey: '',
    }
