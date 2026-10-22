export type ListSortDir = 'asc' | 'desc'

export function parseListSortColumn<T extends string>(
  value: string | null,
  columns: readonly T[],
  fallback: T,
): T {
  return columns.includes(value as T) ? (value as T) : fallback
}

export function parseListSortDir(value: string | null, fallback: ListSortDir = 'desc'): ListSortDir {
  return value === 'asc' || value === 'desc' ? value : fallback
}

/** Клик по колонке: та же — инверсия направления, новая — по умолчанию desc. */
export function nextListSortDir(
  currentColumn: string,
  clickedColumn: string,
  currentDir: ListSortDir,
  defaultDir: ListSortDir = 'desc',
): ListSortDir {
  return currentColumn === clickedColumn ? (currentDir === 'asc' ? 'desc' : 'asc') : defaultDir
}
