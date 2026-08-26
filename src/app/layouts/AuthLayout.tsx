import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'

import { LoadingState } from '@/components/shared/LoadingState'
import { APP_DESCRIPTION, APP_NAME } from '@/lib/constants/app'

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground">
            Э
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{APP_DESCRIPTION}</p>
        </div>
        <Suspense fallback={<LoadingState className="min-h-32" />}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}
