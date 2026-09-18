import type { Permission, Role } from '@/lib/constants/permissions'

export type AuthUser = {
  id: string
  email: string
  fullName: string
  isActive: boolean
  avatarUrl: string | null
  roles: Role[]
  permissions: Permission[]
}
