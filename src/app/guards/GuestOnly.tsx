import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { useAuth } from '@/features/auth'
import { signOut } from '@/features/auth/services/auth-service'
import { routes } from '@/lib/constants/routes'

export function GuestOnly() {
  const { status, errorMessage, refreshUser } = useAuth()
  const location = useLocation()
  const from = getSafeRedirect(location.state)

  if (status === 'bootstrapping') {
    return <LoadingState className="min-h-screen" label="Проверяем сессию…" />
  }

  if (status === 'authenticated') {
    return <Navigate to={from} replace />
  }

  if (status === 'error') {
    return (
      <ErrorState
        className="min-h-screen border-0"
        title="Не удалось войти"
        description={errorMessage ?? 'Проверьте, что у пользователя есть профиль и роль в SQL Editor.'}
        onRetry={() => void refreshUser()}
        action={
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void signOut().finally(() => window.location.assign(routes.login))
            }}
          >
            К форме входа
          </Button>
        }
      />
    )
  }

  return <Outlet />
}

function getSafeRedirect(state: unknown) {
  if (
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof state.from === 'string' &&
    state.from.startsWith('/') &&
    !state.from.startsWith('//')
  ) {
    return state.from
  }

  return routes.home
}
