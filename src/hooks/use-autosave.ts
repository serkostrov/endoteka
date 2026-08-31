import { useEffect, useRef } from 'react'

export const AUTOSAVE_DEBOUNCE_MS = 700

export function useAutosave<T>(
  value: T | null,
  save: (value: T) => Promise<void>,
  delayMs = AUTOSAVE_DEBOUNCE_MS,
) {
  const saveRef = useRef(save)
  const valueRef = useRef(value)
  const pendingRef = useRef(false)

  saveRef.current = save
  valueRef.current = value

  useEffect(() => {
    if (value === null) {
      pendingRef.current = false
      return
    }

    pendingRef.current = true
    const timer = window.setTimeout(() => {
      pendingRef.current = false
      void saveRef.current(value)
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  useEffect(() => {
    return () => {
      if (pendingRef.current && valueRef.current !== null) {
        pendingRef.current = false
        void saveRef.current(valueRef.current)
      }
    }
  }, [])
}
