export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const

export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number]

export const DEFAULT_PAGE_SIZE: PageSizeOption = 20

export const PAGE_SIZE_STORAGE_KEY = 'endoteka.list-page-size'

export function isPageSizeOption(value: number): value is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value)
}
