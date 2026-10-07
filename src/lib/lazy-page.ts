import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const RELOAD_KEY = 'endoteka:chunk-reload'

function isChunkLoadError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message.toLowerCase()
  return (
    message.includes('importing a module script failed') ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('failed to load module script')
  )
}

function reloadOnceForChunkError(error: unknown): never {
  if (typeof window !== 'undefined' && isChunkLoadError(error)) {
    const alreadyReloaded = window.sessionStorage.getItem(RELOAD_KEY) === '1'
    if (!alreadyReloaded) {
      window.sessionStorage.setItem(RELOAD_KEY, '1')
      window.location.reload()
      throw error
    }
  }
  throw error
}

export function lazyNamedPage<Name extends string>(
  loader: () => Promise<Record<Name, ComponentType>>,
  exportName: Name,
): LazyExoticComponent<ComponentType> {
  return lazy(async () => {
    try {
      const pageModule = await loader()
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(RELOAD_KEY)
      }
      const page = pageModule[exportName]
      if (!page) {
        throw new Error(`Страница ${exportName} не найдена в модуле.`)
      }
      return { default: page }
    } catch (error) {
      reloadOnceForChunkError(error)
    }
  })
}
