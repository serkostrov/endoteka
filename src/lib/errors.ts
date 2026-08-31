export class AppError extends Error {
  readonly code: string
  readonly cause: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.cause = cause
  }
}

const AUTH_MESSAGES = {
  invalid_credentials: 'Неверный email или пароль.',
  invalid_grant: 'Неверный email или пароль.',
  email_not_confirmed: 'Подтвердите email, чтобы войти.',
  user_banned: 'Учётная запись заблокирована.',
  over_request_rate_limit: 'Слишком много попыток. Подождите и попробуйте снова.',
} as const

function isInternalErrorMessage(message: string) {
  return /postgres|sql state|relation |column |permission denied for|violates|rpc/i.test(message)
}

function isAuthMessageCode(code: string): code is keyof typeof AUTH_MESSAGES {
  return Object.hasOwn(AUTH_MESSAGES, code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined
  }

  if (typeof error.code === 'string') {
    return error.code
  }

  if (typeof error.error_code === 'string') {
    return error.error_code
  }

  return undefined
}

export function toAppError(error: unknown, fallback = 'Не удалось выполнить операцию. Попробуйте ещё раз.'): AppError {
  if (error instanceof AppError) {
    return error
  }

  const code = readErrorCode(error)
  console.error('Application error', { code })
  if (code && isAuthMessageCode(code)) {
    return new AppError(code, AUTH_MESSAGES[code], error)
  }

  if (isRecord(error) && typeof error.message === 'string') {
    const lowered = error.message.toLowerCase()
    if (lowered.includes('invalid login credentials')) {
      return new AppError('invalid_credentials', AUTH_MESSAGES.invalid_credentials, error)
    }

    if (lowered.includes('auth session missing')) {
      return new AppError('session_missing', 'Сессия не найдена. Войдите ещё раз.', error)
    }

    if (!isInternalErrorMessage(error.message)) {
      return new AppError(code ?? 'APP', error.message, error)
    }
  }

  return new AppError('UNKNOWN', fallback, error)
}

export function getErrorMessage(error: unknown): string {
  return toAppError(error).message
}
