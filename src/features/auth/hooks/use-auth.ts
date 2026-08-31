import { useContext, useEffect, useState } from 'react'

import { Permission } from '@/lib/constants/permissions'
import type { AuthUser } from '@/types/auth'

import { listSavedAccounts, SAVED_ACCOUNTS_EVENT, type SavedAccount } from '../account-locker'
import { AuthContext } from '../auth-context'
import { hasPermission } from '../permissions'

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth должен вызываться внутри AuthProvider.')
  }

  return context
}

export function useCurrentUser(): AuthUser | null {
  return useAuth().user
}

export function useHasPermission(permission: Permission): boolean {
  return hasPermission(useAuth().user, permission)
}

export function useSavedAccounts(): SavedAccount[] {
  const [accounts, setAccounts] = useState(listSavedAccounts)

  useEffect(() => {
    function sync() {
      setAccounts(listSavedAccounts())
    }

    window.addEventListener(SAVED_ACCOUNTS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SAVED_ACCOUNTS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return accounts
}
