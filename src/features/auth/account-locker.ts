const STORAGE_KEY = 'endoteka.saved-accounts'
export const SAVED_ACCOUNTS_EVENT = 'endoteka:saved-accounts'

export type SavedAccount = {
  userId: string
  email: string
  fullName: string
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  lastUsedAt: string
}

function notify() {
  window.dispatchEvent(new Event(SAVED_ACCOUNTS_EVENT))
}

function readAccounts(): SavedAccount[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isSavedAccount)
  } catch {
    return []
  }
}

function writeAccounts(accounts: SavedAccount[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts))
  notify()
}

function isSavedAccount(value: unknown): value is SavedAccount {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as SavedAccount
  return (
    typeof row.userId === 'string' &&
    typeof row.email === 'string' &&
    typeof row.fullName === 'string' &&
    typeof row.accessToken === 'string' &&
    typeof row.refreshToken === 'string' &&
    (row.expiresAt === null || typeof row.expiresAt === 'number') &&
    typeof row.lastUsedAt === 'string'
  )
}

export function listSavedAccounts(): SavedAccount[] {
  return readAccounts().sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
}

export function getSavedAccount(userId: string): SavedAccount | null {
  return readAccounts().find((account) => account.userId === userId) ?? null
}

export function upsertSavedAccount(next: SavedAccount) {
  const accounts = readAccounts().filter((account) => account.userId !== next.userId)
  accounts.push(next)
  writeAccounts(accounts)
}

export function updateSavedAccountProfile(userId: string, profile: { email: string; fullName: string }) {
  const accounts = readAccounts().map((account) =>
    account.userId === userId
      ? { ...account, email: profile.email, fullName: profile.fullName || account.fullName }
      : account,
  )
  writeAccounts(accounts)
}

export function removeSavedAccount(userId: string) {
  writeAccounts(readAccounts().filter((account) => account.userId !== userId))
}

export function clearSavedAccounts() {
  writeAccounts([])
}
