import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { calcCompletenessPct } from './completeness'
import type { AssemblyPart } from '../services/assembly-service'

export type AssemblyPartDraft = {
  /** Стабильный ключ строки в UI. */
  key: string
  /** ID в БД; null — ещё не сохранена. */
  serverId: string | null
  name: string
  qtyRequired: number
  qtyCollected: number
  comment: string
  sortOrder: number
}

type AssemblyPartsDraftContextValue = {
  parts: AssemblyPartDraft[]
  dirty: boolean
  completenessPct: number
  addPart: (input: {
    name: string
    qtyRequired: number
    qtyCollected: number
    comment: string
  }) => void
  updatePart: (
    key: string,
    patch: Partial<Pick<AssemblyPartDraft, 'name' | 'qtyRequired' | 'qtyCollected' | 'comment'>>,
  ) => void
  removePart: (key: string) => void
  resetFromServer: (parts: AssemblyPart[]) => void
  toSavePayload: () => Array<{
    id: string | null
    name: string
    qty_required: number
    qty_collected: number
    comment: string
    sort_order: number
  }>
}

const AssemblyPartsDraftContext = createContext<AssemblyPartsDraftContextValue | null>(null)

function mapServerParts(parts: AssemblyPart[]): AssemblyPartDraft[] {
  return parts.map((part, index) => ({
    key: part.id,
    serverId: part.id,
    name: part.name,
    qtyRequired: part.qtyRequired,
    qtyCollected: part.qtyCollected,
    comment: part.comment,
    sortOrder: part.sortOrder ?? index,
  }))
}

function normalizeForCompare(parts: AssemblyPartDraft[]) {
  return parts.map((part) => ({
    serverId: part.serverId,
    name: part.name.trim(),
    qtyRequired: part.qtyRequired,
    qtyCollected: part.qtyCollected,
    comment: part.comment.trim(),
    sortOrder: part.sortOrder,
  }))
}

function partsEqual(a: AssemblyPartDraft[], b: AssemblyPartDraft[]) {
  return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b))
}

export function AssemblyPartsDraftProvider({
  serverParts,
  children,
}: {
  serverParts: AssemblyPart[]
  children: ReactNode
}) {
  const [baseline, setBaseline] = useState(() => mapServerParts(serverParts))
  const [parts, setParts] = useState(() => mapServerParts(serverParts))
  const dirty = useMemo(() => !partsEqual(parts, baseline), [parts, baseline])
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    const next = mapServerParts(serverParts)
    setBaseline(next)
    if (!dirtyRef.current) {
      setParts(next)
    }
  }, [serverParts])

  const completenessPct = useMemo(() => calcCompletenessPct(parts), [parts])

  const resetFromServer = useCallback((nextServer: AssemblyPart[]) => {
    const next = mapServerParts(nextServer)
    setBaseline(next)
    setParts(next)
  }, [])

  const addPart = useCallback(
    (input: { name: string; qtyRequired: number; qtyCollected: number; comment: string }) => {
      setParts((prev) => [
        ...prev,
        {
          key: `draft:${crypto.randomUUID()}`,
          serverId: null,
          name: input.name.trim(),
          qtyRequired: input.qtyRequired,
          qtyCollected: input.qtyCollected,
          comment: input.comment.trim(),
          sortOrder: prev.length,
        },
      ])
    },
    [],
  )

  const updatePart = useCallback(
    (
      key: string,
      patch: Partial<Pick<AssemblyPartDraft, 'name' | 'qtyRequired' | 'qtyCollected' | 'comment'>>,
    ) => {
      setParts((prev) =>
        prev.map((part) => {
          if (part.key !== key) {
            return part
          }
          return {
            ...part,
            ...patch,
            name: patch.name !== undefined ? patch.name : part.name,
            comment: patch.comment !== undefined ? patch.comment : part.comment,
          }
        }),
      )
    },
    [],
  )

  const removePart = useCallback((key: string) => {
    setParts((prev) =>
      prev
        .filter((part) => part.key !== key)
        .map((part, index) => ({ ...part, sortOrder: index })),
    )
  }, [])

  const toSavePayload = useCallback(
    () =>
      parts.map((part, index) => ({
        id: part.serverId,
        name: part.name.trim(),
        qty_required: part.qtyRequired,
        qty_collected: part.qtyCollected,
        comment: part.comment.trim(),
        sort_order: index,
      })),
    [parts],
  )

  const value = useMemo(
    () => ({
      parts,
      dirty,
      completenessPct,
      addPart,
      updatePart,
      removePart,
      resetFromServer,
      toSavePayload,
    }),
    [
      parts,
      dirty,
      completenessPct,
      addPart,
      updatePart,
      removePart,
      resetFromServer,
      toSavePayload,
    ],
  )

  return (
    <AssemblyPartsDraftContext.Provider value={value}>{children}</AssemblyPartsDraftContext.Provider>
  )
}

export function useAssemblyPartsDraft() {
  const ctx = useContext(AssemblyPartsDraftContext)
  if (!ctx) {
    throw new Error('useAssemblyPartsDraft must be used within AssemblyPartsDraftProvider')
  }
  return ctx
}
