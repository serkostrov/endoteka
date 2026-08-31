export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    return ''
  }

  if (bytes < 1024) {
    return `${bytes} Б`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} КБ`
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}
