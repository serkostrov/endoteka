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
import { useSearchParams } from 'react-router-dom'

import { SHEET_EXIT_MS, SheetLayer, SheetStackMeta } from '@/components/ui/sheet'
import { CustomerDetailSheet } from '@/features/customers'
import { DeviceDetailSheet } from '@/features/devices'
import { InventoryCountSheet } from '@/features/inventory/components/InventoryCountScreen'
import { InventoryItemSheet } from '@/features/inventory/components/InventoryItemScreen'
import { InventoryReceiptSheet } from '@/features/inventory/components/InventoryReceiptSheet'
import { OrderDetailSheet } from '@/features/orders'
import { SaleDetailSheet } from '@/features/sales'
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet'

export type EntitySheetKind =
  | 'customer'
  | 'device'
  | 'item'
  | 'order'
  | 'task'
  | 'sale'
  | 'count'
  | 'receipt'

export type EntitySheetEntry = {
  kind: EntitySheetKind
  id: string
}

const STACK_PARAM = 'stack'

type SheetStackContextValue = {
  stack: EntitySheetEntry[]
  open: (entry: EntitySheetEntry) => void
  closeTop: () => void
  closeAt: (index: number) => void
  setVisualTopLevel: (level: number) => void
}

const SheetStackContext = createContext<SheetStackContextValue | null>(null)

const KINDS = new Set<EntitySheetKind>([
  'customer',
  'device',
  'item',
  'order',
  'task',
  'sale',
  'count',
  'receipt',
])

function parseStack(raw: string | null): EntitySheetEntry[] {
  if (!raw) {
    return []
  }
  const result: EntitySheetEntry[] = []
  for (const part of raw.split(',')) {
    const sep = part.indexOf(':')
    if (sep <= 0) {
      continue
    }
    const kind = part.slice(0, sep) as EntitySheetKind
    const id = decodeURIComponent(part.slice(sep + 1))
    if (!KINDS.has(kind) || !id) {
      continue
    }
    result.push({ kind, id })
  }
  return result
}

function serializeStack(stack: EntitySheetEntry[]) {
  return stack.map((entry) => `${entry.kind}:${encodeURIComponent(entry.id)}`).join(',')
}

type PaintedItem = {
  entry: EntitySheetEntry
  open: boolean
}

export function SheetStackProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const stack = useMemo(() => parseStack(searchParams.get(STACK_PARAM)), [searchParams])
  const [visualTopLevel, setVisualTopLevel] = useState(stack.length)

  const write = useCallback(
    (next: EntitySheetEntry[]) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          if (next.length === 0) {
            params.delete(STACK_PARAM)
          } else {
            params.set(STACK_PARAM, serializeStack(next))
          }
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const open = useCallback(
    (entry: EntitySheetEntry) => {
      const withoutDup = stack.filter((item) => !(item.kind === entry.kind && item.id === entry.id))
      write([...withoutDup, entry])
    },
    [stack, write],
  )

  const closeTop = useCallback(() => {
    if (stack.length === 0) {
      return
    }
    write(stack.slice(0, -1))
  }, [stack, write])

  const closeAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= stack.length) {
        return
      }
      write(stack.slice(0, index))
    },
    [stack, write],
  )

  const value = useMemo(
    () => ({ stack, open, closeTop, closeAt, setVisualTopLevel }),
    [stack, open, closeTop, closeAt],
  )

  return (
    <SheetStackContext.Provider value={value}>
      <SheetStackMeta topLevel={visualTopLevel}>{children}</SheetStackMeta>
    </SheetStackContext.Provider>
  )
}

export function useEntitySheet() {
  const ctx = useContext(SheetStackContext)
  if (!ctx) {
    throw new Error('useEntitySheet must be used within SheetStackProvider')
  }
  return ctx
}

/** Открыть карточку поверх текущего экрана / sheet’а, без смены раздела. */
export function useOpenEntitySheet() {
  const { open } = useEntitySheet()
  return useCallback(
    (kind: EntitySheetKind, id: string) => {
      open({ kind, id })
    },
    [open],
  )
}

export function SheetStackHost() {
  const { stack, closeAt, setVisualTopLevel } = useEntitySheet()
  const [items, setItems] = useState<PaintedItem[]>(() => stack.map((entry) => ({ entry, open: true })))
  const closingRef = useRef(false)
  const exitTimerRef = useRef<number | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const openCount = items.reduce((count, item) => count + (item.open ? 1 : 0), 0)

  useEffect(() => {
    setVisualTopLevel(openCount)
  }, [openCount, setVisualTopLevel])

  useEffect(() => {
    const current = itemsRef.current
    const openEntries = current.filter((item) => item.open).map((item) => item.entry)
    const stackKey = serializeStack(stack)
    const openKey = serializeStack(openEntries)

    if (stackKey === openKey) {
      if (!closingRef.current && current.length !== stack.length) {
        setItems(stack.map((entry) => ({ entry, open: true })))
      }
      return
    }

    if (stack.length >= openEntries.length) {
      closingRef.current = false
      if (exitTimerRef.current != null) {
        window.clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
      setItems(stack.map((entry) => ({ entry, open: true })))
      return
    }

    // URL укоротился снаружи (назад) — slide-out, потом sync
    if (!closingRef.current) {
      closingRef.current = true
      setItems((prev) =>
        prev.map((item, index) => (index >= stack.length ? { ...item, open: false } : item)),
      )
      exitTimerRef.current = window.setTimeout(() => {
        closingRef.current = false
        exitTimerRef.current = null
        setItems(stack.map((entry) => ({ entry, open: true })))
      }, SHEET_EXIT_MS)
    }
  }, [stack])

  useEffect(() => {
    return () => {
      if (exitTimerRef.current != null) {
        window.clearTimeout(exitTimerRef.current)
      }
    }
  }, [])

  const requestClose = useCallback(
    (index: number) => {
      if (closingRef.current) {
        return
      }
      closingRef.current = true
      setItems((prev) => prev.map((item, i) => (i >= index ? { ...item, open: false } : item)))
      if (exitTimerRef.current != null) {
        window.clearTimeout(exitTimerRef.current)
      }
      exitTimerRef.current = window.setTimeout(() => {
        closingRef.current = false
        exitTimerRef.current = null
        closeAt(index)
        setItems((prev) => prev.slice(0, index))
      }, SHEET_EXIT_MS)
    },
    [closeAt],
  )

  return (
    <>
      {items.map((item, index) => {
        const layer = index + 1
        const onOpenChange = (next: boolean) => {
          if (!next) {
            requestClose(index)
          }
        }
        const key = `${item.entry.kind}:${item.entry.id}:${index}`
        const { entry, open } = item

        return (
          <SheetLayer key={key} level={layer}>
            {entry.kind === 'customer' ? (
              <CustomerDetailSheet customerId={entry.id} open={open} onOpenChange={onOpenChange} />
            ) : null}
            {entry.kind === 'device' ? (
              <DeviceDetailSheet deviceId={entry.id} open={open} onOpenChange={onOpenChange} />
            ) : null}
            {entry.kind === 'item' ? (
              <InventoryItemSheet itemId={entry.id} open={open} onOpenChange={onOpenChange} />
            ) : null}
            {entry.kind === 'order' ? (
              <OrderDetailSheet orderId={entry.id} open={open} onOpenChange={onOpenChange} />
            ) : null}
            {entry.kind === 'task' ? (
              <TaskDetailSheet taskId={entry.id} open={open} onOpenChange={onOpenChange} />
            ) : null}
            {entry.kind === 'sale' ? (
              <SaleDetailSheet saleId={entry.id} open={open} onOpenChange={onOpenChange} />
            ) : null}
            {entry.kind === 'count' ? (
              <InventoryCountSheet countId={entry.id} open={open} onOpenChange={onOpenChange} />
            ) : null}
            {entry.kind === 'receipt' ? (
              <InventoryReceiptSheet receiptId={entry.id} open={open} onOpenChange={onOpenChange} />
            ) : null}
          </SheetLayer>
        )
      })}
    </>
  )
}
