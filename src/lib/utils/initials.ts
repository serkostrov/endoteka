export function getInitials(value: string) {
  const parts = value.split(/[\s@]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? 'Э'
  const second = parts[1]?.[0] ?? ''
  return `${first}${second}`.toUpperCase()
}
