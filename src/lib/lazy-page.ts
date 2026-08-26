import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export function lazyNamedPage<Name extends string>(
  loader: () => Promise<Record<Name, ComponentType>>,
  exportName: Name,
): LazyExoticComponent<ComponentType> {
  return lazy(async () => {
    const pageModule = await loader()
    return { default: pageModule[exportName] }
  })
}
