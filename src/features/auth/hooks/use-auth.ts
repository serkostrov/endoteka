import { useContext } from 'react'

import { Permission } from '@/lib/constants/permissions'
import type { AuthUser } from '@/types/auth'

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
