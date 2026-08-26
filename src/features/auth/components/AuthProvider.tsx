import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { getErrorMessage } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'
import type { AuthUser } from '@/types/auth'

import { AuthContext, type AuthStatus } from '../auth-context'
import { getCurrentUser } from '../services/auth-service'

type AuthState = {
  status: AuthStatus
  user: AuthUser | null
  errorMessage: string | null
}

const initialState: AuthState = {
  status: 'bootstrapping',
  user: null,
  errorMessage: null,
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState)

  const refreshUser = useCallback(async () => {
    try {
      const user = await getCurrentUser()
      setState({
        status: user ? 'authenticated' : 'anonymous',
        user,
        errorMessage: null,
      })
    } catch (error: unknown) {
      setState({
        status: 'error',
        user: null,
        errorMessage: getErrorMessage(error),
      })
    }
  }, [])

  useEffect(() => {
    const supabase = getSupabase()

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setState({
          status: 'anonymous',
          user: null,
          errorMessage: null,
        })
        return
      }

      window.setTimeout(() => {
        void refreshUser()
      }, 0)
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [refreshUser])

  return <AuthContext.Provider value={{ ...state, refreshUser }}>{children}</AuthContext.Provider>
}
