import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { PrintableItemLabel } from './print-item-labels'
import {
  BUILTIN_ITEM_LABEL_TEMPLATE_ID,
  readItemLabelTemplatePreference,
  writeItemLabelTemplatePreference,
} from './item-label-template-preference'

type ItemLabelPrintContextValue = {
  /** Снимок полей этикетки — то, что на превью / уйдёт в печать. */
  getSnapshot: () => PrintableItemLabel | null
  setSnapshot: (getter: (() => PrintableItemLabel) | null) => void
  /** Выбранный шаблон этикетки (builtin или id из настроек). */
  templateId: string
  setTemplateId: (templateId: string) => void
}

const ItemLabelPrintContext = createContext<ItemLabelPrintContextValue | null>(null)

export function ItemLabelPrintProvider({ children }: { children: ReactNode }) {
  const getterRef = useRef<(() => PrintableItemLabel) | null>(null)
  const [templateId, setTemplateIdState] = useState(readItemLabelTemplatePreference)

  const setSnapshot = useCallback((getter: (() => PrintableItemLabel) | null) => {
    getterRef.current = getter
  }, [])

  const getSnapshot = useCallback(() => getterRef.current?.() ?? null, [])

  const setTemplateId = useCallback((next: string) => {
    const value = next.trim() || BUILTIN_ITEM_LABEL_TEMPLATE_ID
    setTemplateIdState(value)
    writeItemLabelTemplatePreference(value)
  }, [])

  const value = useMemo(
    () => ({ getSnapshot, setSnapshot, templateId, setTemplateId }),
    [getSnapshot, setSnapshot, templateId, setTemplateId],
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
