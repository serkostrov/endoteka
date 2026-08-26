import { Outlet } from 'react-router-dom'

import { AccessDenied } from '@/components/shared/AccessDenied'
import { useAuth } from '@/features/auth'
import { hasPermission } from '@/features/auth/permissions'
import type { Permission } from '@/lib/constants/permissions'

type RequirePermissionProps = {
  permission: Permission
}

export function RequirePermission({ permission }: RequirePermissionProps) {
  const { user } = useAuth()

  if (!hasPermission(user, permission)) {
    return <AccessDenied />
  }

  return <Outlet />
}
