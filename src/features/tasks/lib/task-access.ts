/** Своя задача или есть право на чужие/общие. */
export function canAccessOwnedOrManagedTask(input: {
  assigneeId: string | null
  currentUserId: string | null | undefined
  canManageOthers: boolean
}) {
  if (input.canManageOthers) {
    return true
  }
  return Boolean(input.currentUserId) && input.assigneeId === input.currentUserId
}

/** Можно ли менять/закрывать задачу: своя при tasks:update, чужая/общая — ещё и tasks:manage_others. */
export function canMutateTaskAccess(input: {
  assigneeId: string | null
  currentUserId: string | null | undefined
  canUpdate: boolean
  canManageOthers: boolean
}) {
  if (!input.canUpdate) {
    return false
  }
  return canAccessOwnedOrManagedTask(input)
}
