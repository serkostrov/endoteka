import type { Permission, Role } from '@/lib/constants/permissions'

export type AuthUser = {
  id: string
  email: string
  fullName: string
  isActive: boolean
  roles: Role[]
  permissions: Permission[]
}
