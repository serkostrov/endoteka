import { useState } from 'react'

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_STORAGE_KEY,
  isPageSizeOption,
  type PageSizeOption,
} from '@/lib/constants/pagination'

function readStoredPageSize(): PageSizeOption {
  try {
    const raw = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY)
    const parsed = raw ? Number(raw) : NaN
    if (isPageSizeOption(parsed)) {
      return parsed
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_PAGE_SIZE
}

export function usePageSize() {
  const [pageSize, setPageSizeState] = useState<PageSizeOption>(readStoredPageSize)

  function setPageSize(next: number) {
    if (!isPageSizeOption(next)) {
      return
    }
    setPageSizeState(next)
    try {
      window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next))
    } catch {
      // ignore storage errors
    }
  }

  return [pageSize, setPageSize] as const
}
