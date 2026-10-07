import { AppError, toAppError } from '@/lib/errors'

import { getSupabase } from './client'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readFunctionErrorMessage(data: unknown, error: unknown): Promise<string | null> {
  if (isRecord(data) && typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim()
  }

  if (!isRecord(error) || !('context' in error)) {
    return null
  }

  const context = error.context
  if (!(context instanceof Response)) {
    return null
  }

  try {
    const payload = await context.clone().json()
    if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim()
    }
  } catch {
    // ignore non-JSON bodies
  }

  return null
}

export async function invokeEdgeFunction<T extends Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke(name, { body })
  const message = await readFunctionErrorMessage(data, error)

  if (message) {
    throw new AppError('EDGE', message, error ?? data)
  }

  if (error) {
    throw toAppError(error, fallback)
  }

  if (!isRecord(data)) {
    throw new AppError('EDGE', fallback)
  }

  return data as T
}
