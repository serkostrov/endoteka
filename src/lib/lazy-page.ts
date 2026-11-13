import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

import { clearChunkReloadFlag, reloadOnceForChunkError } from '@/lib/chunk-load'

export function lazyNamedPage<Name extends string>(
  loader: () => Promise<Record<Name, ComponentType>>,
  exportName: Name,
): LazyExoticComponent<ComponentType> {
  return lazy(async () => {
    try {
      const pageModule = await loader()
      clearChunkReloadFlag()
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
