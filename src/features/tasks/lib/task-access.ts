/** Своя (исполнитель или автор) либо есть право на чужие/общие. */
export function canAccessOwnedOrManagedTask(input: {
  assigneeId: string | null
  createdBy?: string | null
  currentUserId: string | null | undefined
  canManageOthers: boolean
}) {
  if (input.canManageOthers) {
    return true
  }
  if (!input.currentUserId) {
    return false
  }
  return input.assigneeId === input.currentUserId || input.createdBy === input.currentUserId
}

/** Можно ли менять/закрывать задачу: своя/созданная мной при tasks:update, чужая — ещё и tasks:manage_others. */
export function canMutateTaskAccess(input: {
  assigneeId: string | null
  createdBy?: string | null
  currentUserId: string | null | undefined
  canUpdate: boolean
  canManageOthers: boolean
}) {
  if (!input.canUpdate) {
    return false
  }
  return canAccessOwnedOrManagedTask(input)
}
