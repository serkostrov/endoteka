import { Permission, Role } from '@/lib/constants/permissions'
import type { AuthUser } from '@/types/auth'

const roles = new Set<string>(Object.values(Role))
const permissions = new Set<string>(Object.values(Permission))

function isRole(value: string): value is Role {
  return roles.has(value)
}

function isPermission(value: string): value is Permission {
  return permissions.has(value)
}

export function hasPermission(user: AuthUser | null, permission: Permission): boolean {
  return Boolean(user?.permissions.includes(permission))
}

export function hasRole(user: AuthUser | null, role: Role): boolean {
  return Boolean(user?.roles.includes(role))
}

export function parseRoles(values: string[]): Role[] {
  return values.filter(isRole)
}

export function parsePermissions(values: string[]): Permission[] {
  return values.filter(isPermission)
}
