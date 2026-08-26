export function isSafeHttpUrl(value: string) {
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password) {
      return false
    }
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}
