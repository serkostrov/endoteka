import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { useAuth } from '@/features/auth'
import { routes } from '@/lib/constants/routes'

export function RequireAuth() {
  const { status, errorMessage } = useAuth()
  const location = useLocation()

  if (status === 'bootstrapping') {
    return <LoadingState className="min-h-screen" label="Проверяем сессию…" />
  }

  if (status === 'error') {
    return (
      <ErrorState
        className="min-h-screen border-0"
        description={errorMessage ?? 'Не удалось загрузить сессию.'}
        onRetry={() => window.location.reload()}
      />
    )
  }

  if (status !== 'authenticated') {
    return <Navigate to={routes.login} replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
