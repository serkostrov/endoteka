import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { waitForSession } from '@/features/auth/services/auth-service'
import { routes } from '@/lib/constants/routes'

export function AuthCallbackPage() {
  const sessionQuery = useQuery({
    queryKey: ['auth', 'callback-session'],
    queryFn: () => waitForSession(),
    staleTime: Infinity,
    retry: false,
  })

  if (sessionQuery.isPending) {
    return <LoadingState label="Завершаем вход…" />
  }

  if (!sessionQuery.data) {
    return (
      <ErrorState
        title="Приглашение не принято"
        description="Не удалось завершить вход по приглашению. Запросите новое письмо."
      />
    )
  }

  return <Navigate to={routes.setPassword} replace />
}
