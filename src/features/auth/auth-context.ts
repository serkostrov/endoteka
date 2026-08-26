import { createContext } from 'react'

import type { AuthUser } from '@/types/auth'

export type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated' | 'error'

export type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  errorMessage: string | null
  refreshUser: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
