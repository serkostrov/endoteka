import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'

import type { PrintableItemLabel } from './print-item-labels'

type ItemLabelPrintContextValue = {
  /** Снимок полей этикетки — то, что на превью / уйдёт в печать. */
  getSnapshot: () => PrintableItemLabel | null
  setSnapshot: (getter: (() => PrintableItemLabel) | null) => void
}

const ItemLabelPrintContext = createContext<ItemLabelPrintContextValue | null>(null)

export function ItemLabelPrintProvider({ children }: { children: ReactNode }) {
  const getterRef = useRef<(() => PrintableItemLabel) | null>(null)

  const setSnapshot = useCallback((getter: (() => PrintableItemLabel) | null) => {
    getterRef.current = getter
  }, [])

  const getSnapshot = useCallback(() => getterRef.current?.() ?? null, [])

  const value = useMemo(
    () => ({ getSnapshot, setSnapshot }),
    [getSnapshot, setSnapshot],
  )

  return <ItemLabelPrintContext.Provider value={value}>{children}</ItemLabelPrintContext.Provider>
}

export function useItemLabelPrint() {
  return useContext(ItemLabelPrintContext)
}

/** Регистрирует снимок этикетки из формы карточки (WYSIWYG для тулбара). */
export function useRegisterItemLabelSnapshot(getSnapshot: () => PrintableItemLabel) {
  const ctx = useItemLabelPrint()
  const setSnapshot = ctx?.setSnapshot
  const getRef = useRef(getSnapshot)
  getRef.current = getSnapshot

  useLayoutEffect(() => {
    if (!setSnapshot) {
      return
    }
    setSnapshot(() => getRef.current())
    return () => setSnapshot(null)
  }, [setSnapshot])
}
