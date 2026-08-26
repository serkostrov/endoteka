import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { LoadingState } from '@/components/shared/LoadingState'
import { useAuth } from '@/features/auth'
import { routes } from '@/lib/constants/routes'

export function GuestOnly() {
  const { status } = useAuth()
  const location = useLocation()
  const from = getSafeRedirect(location.state)

  if (status === 'bootstrapping') {
    return <LoadingState className="min-h-screen" label="Проверяем сессию…" />
  }

  if (status === 'authenticated') {
    return <Navigate to={from} replace />
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
