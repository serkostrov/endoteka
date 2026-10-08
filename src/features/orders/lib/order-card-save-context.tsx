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

export type OrderCardSaveHandler = {
  dirty: boolean
  saving: boolean
  save: () => Promise<void>
}

type OrderCardSaveContextValue = {
  dirty: boolean
  saving: boolean
  save: () => Promise<void>
  setHandler: (id: string, handler: OrderCardSaveHandler | null) => void
}

const OrderCardSaveContext = createContext<OrderCardSaveContextValue | null>(null)

export function OrderCardSaveProvider({ children }: { children: ReactNode }) {
  const [handlers, setHandlers] = useState<Record<string, OrderCardSaveHandler>>({})
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const setHandler = useCallback((id: string, next: OrderCardSaveHandler | null) => {
    setHandlers((current) => {
      const prev = current[id]
      if (!next) {
        if (!prev) {
          return current
        }
        const { [id]: _, ...rest } = current
        return rest
      }
      if (prev?.dirty === next.dirty && prev.saving === next.saving && prev.save === next.save) {
        return current
      }
      return { ...current, [id]: next }
    })
  }, [])

  const save = useCallback(async () => {
    const entries = Object.values(handlersRef.current).filter((handler) => handler.dirty)
    for (const handler of entries) {
      await handler.save()
    }
  }, [])

  const dirty = Object.values(handlers).some((handler) => handler.dirty)
  const saving = Object.values(handlers).some((handler) => handler.saving)

  const value = useMemo<OrderCardSaveContextValue>(
    () => ({
      dirty,
      saving,
      save,
      setHandler,
    }),
    [dirty, save, saving, setHandler],
  )

  return <OrderCardSaveContext.Provider value={value}>{children}</OrderCardSaveContext.Provider>
}

export function useOrderCardSave() {
  return useContext(OrderCardSaveContext)
}

/** Регистрирует сохранение вкладки в футере карточки заказа (можно несколько сразу). */
export function useRegisterOrderCardSave(
  id: string,
  options: {
    dirty: boolean
    saving: boolean
    save: () => Promise<void>
    enabled?: boolean
  },
) {
  const { dirty, saving, save, enabled = true } = options
  const ctx = useOrderCardSave()
  const setHandler = ctx?.setHandler
  const saveRef = useRef(save)
  saveRef.current = save

  const stableSave = useCallback(async () => {
    await saveRef.current()
  }, [])

  useLayoutEffect(() => {
    if (!setHandler || !enabled) {
      return
    }
    setHandler(id, { dirty, saving, save: stableSave })
    return () => setHandler(id, null)
  }, [dirty, enabled, id, saving, setHandler, stableSave])
}
