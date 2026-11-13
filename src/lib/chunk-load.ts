const RELOAD_AT_KEY = 'endoteka:chunk-reload-at'
/** Не крутим reload-луп, если ассеты реально битые на сервере. */
const RELOAD_COOLDOWN_MS = 15_000

export function isChunkLoadError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message.toLowerCase()
  return (
    message.includes('importing a module script failed') ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('failed to load module script') ||
    message.includes('loading chunk') ||
    message.includes('loading css chunk')
  )
}

/** Один hard-reload при устаревшем чанке после деплоя. */
export function reloadOnceForChunkError(error: unknown): never {
  if (typeof window !== 'undefined' && isChunkLoadError(error)) {
    const last = Number(window.sessionStorage.getItem(RELOAD_AT_KEY) || '0')
    const now = Date.now()
    if (!Number.isFinite(last) || now - last > RELOAD_COOLDOWN_MS) {
      window.sessionStorage.setItem(RELOAD_AT_KEY, String(now))
      window.location.reload()
    }
  }
  throw error
}

export function clearChunkReloadFlag() {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(RELOAD_AT_KEY)
  }
}

/** Vite шлёт это, когда preload чанка падает после нового деплоя. */
export function installVitePreloadErrorHandler() {
  if (typeof window === 'undefined') {
    return
  }
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    try {
      reloadOnceForChunkError(new Error('Failed to fetch dynamically imported module'))
    } catch {
      // уже перезагружались недавно — оставляем ошибку роутеру
    }
  })
}
