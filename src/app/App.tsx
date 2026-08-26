import { ConfigErrorScreen } from '@/components/shared/ConfigErrorScreen'
import { env } from '@/config/env'

import { AppProviders } from './providers/AppProviders'
import { AppRouter } from './router'

export function App() {
  if (!env.isConfigured) {
    return <ConfigErrorScreen />
  }

  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  )
}
