import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"
import type { FieldValues, UseFormHandleSubmit } from "react-hook-form"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { getErrorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

/** После закрытия вложенного Dialog Radix может дернуть onOpenChange(false) у Sheet — игнорируем коротко. */
let nestedDialogCloseIgnoreUntil = 0

export function markNestedDialogClosing() {
  nestedDialogCloseIgnoreUntil = performance.now() + 1200
}

export function shouldIgnoreNestedDialogClose() {
  return performance.now() < nestedDialogCloseIgnoreUntil
}

type SheetSaveFn = () => void | Promise<void>

type SheetDirtyContextValue = {
  setSourceDirty: (id: string, dirty: boolean, save?: SheetSaveFn | null) => void
}

const SheetDirtyContext = React.createContext<SheetDirtyContextValue | null>(null)

/** Уровень вложенности sheet’а: 0 — базовый, выше — поверх предыдущих. */
const SheetLayerContext = React.createContext(0)

/** Сколько уровней стека сейчас открыто (верхний layer = topLevel). */
const SheetTopLevelContext = React.createContext(0)

function SheetLayer({ level, children }: { level: number; children: React.ReactNode }) {
  return <SheetLayerContext.Provider value={level}>{children}</SheetLayerContext.Provider>
}

function SheetStackMeta({ topLevel, children }: { topLevel: number; children: React.ReactNode }) {
  return <SheetTopLevelContext.Provider value={topLevel}>{children}</SheetTopLevelContext.Provider>
}

function sheetZIndex(layer: number) {
  return 50 + Math.max(0, layer) * 10
}

/** Насколько нижний sheet шире верхнего (выглядывает слева, правый край на месте). */
const SHEET_PEEK_REM = 3.5

/** Длительность slide-out; держим контент смонтированным, пока играет анимация. */
export const SHEET_EXIT_MS = 320

function sheetBaseMaxToken(className?: string): string | null {
  if (!className) {
    return null
  }
  const match = className.match(/max-w-\[min\(96vw,([^\]\)]+)\)\]/)
  return match?.[1]?.trim() ?? null
}

/**
 * Сохраняет id и контент на время закрытия, чтобы Radix успел проиграть exit-анимацию
 * (родитель часто сразу сбрасывает open/id в URL).
 */
export function useSheetExitPresence(open: boolean, id: string | null | undefined) {
  const [activeId, setActiveId] = React.useState<string | null>(id ?? null)
  const [visible, setVisible] = React.useState(Boolean(open && id))

  React.useLayoutEffect(() => {
    if (open && id) {
      setActiveId(id)
      setVisible(true)
      return
    }
    if (!open) {
      setVisible(false)
    }
  }, [open, id])

  React.useEffect(() => {
    if (visible || !activeId) {
      return
    }
    const timer = window.setTimeout(() => setActiveId(null), SHEET_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [visible, activeId])

  return { open: visible, id: activeId }
}

export function useSheetDirty(dirty: boolean, save?: SheetSaveFn) {
  const id = React.useId()
  const ctx = React.useContext(SheetDirtyContext)
  const saveRef = React.useRef(save)
  saveRef.current = save
  const hasSave = Boolean(save)

  React.useLayoutEffect(() => {
    if (!ctx) {
      return
    }
    ctx.setSourceDirty(id, dirty, hasSave ? () => saveRef.current?.() : null)
    return () => ctx.setSourceDirty(id, false, null)
  }, [ctx, dirty, hasSave, id])
}

export async function runSheetFormSave<T extends FieldValues>(
  handleSubmit: UseFormHandleSubmit<T>,
  persist: (values: T) => Promise<void>,
) {
  let saved = false
  await handleSubmit(async (values) => {
    await persist(values)
    saved = true
  })()
  if (!saved) {
    throw new Error("Проверьте поля формы")
  }
}

function Sheet({
  dirty = false,
  onSave,
  open,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root> & {
  dirty?: boolean
  onSave?: SheetSaveFn
}) {
  const sources = React.useRef(new Map<string, { dirty: boolean; save: SheetSaveFn | null }>())
  const [registeredDirty, setRegisteredDirty] = React.useState(false)
  const [registeredCanSave, setRegisteredCanSave] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const blocked = dirty || registeredDirty
  const canSaveAndExit = Boolean(onSave) || registeredCanSave
  const onSaveRef = React.useRef(onSave)
  onSaveRef.current = onSave

  const syncSources = React.useCallback(() => {
    let nextDirty = false
    let nextCanSave = false
    for (const source of sources.current.values()) {
      if (!source.dirty) {
        continue
      }
      nextDirty = true
      if (source.save) {
        nextCanSave = true
      }
    }
    setRegisteredDirty(nextDirty)
    setRegisteredCanSave(nextCanSave)
  }, [])

  const setSourceDirty = React.useCallback(
    (id: string, value: boolean, save?: SheetSaveFn | null) => {
      if (!value && !save) {
        sources.current.delete(id)
      } else {
        sources.current.set(id, { dirty: value, save: save ?? null })
      }
      syncSources()
    },
    [syncSources],
  )

  const context = React.useMemo(() => ({ setSourceDirty }), [setSourceDirty])

  React.useEffect(() => {
    if (open === false) {
      setConfirmOpen(false)
      setSaving(false)
    }
  }, [open])

  function closeSheet() {
    sources.current.clear()
    setRegisteredDirty(false)
    setRegisteredCanSave(false)
    setConfirmOpen(false)
    setSaving(false)
    onOpenChange?.(false)
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      onOpenChange?.(true)
      return
    }
    // Вложенный Dialog (например «Новая запись») поверх Sheet —
    // не закрывать sheet и не показывать «несохранённые изменения».
    if (typeof document !== "undefined" && document.querySelector('[data-slot="dialog-content"]')) {
      return
    }
    if (shouldIgnoreNestedDialogClose()) {
      return
    }
    if (blocked) {
      setConfirmOpen(true)
      return
    }
    closeSheet()
  }

  async function saveAndExit() {
    const saves = [...sources.current.values()]
      .filter((source) => source.dirty && source.save)
      .map((source) => source.save as SheetSaveFn)

    setSaving(true)
    try {
      if (onSaveRef.current) {
        await onSaveRef.current()
      } else {
        for (const save of saves) {
          await save()
        }
      }
      closeSheet()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SheetDirtyContext.Provider value={context}>
      <SheetPrimitive.Root data-slot="sheet" open={open} onOpenChange={handleOpenChange} {...props}>
        {children}
      </SheetPrimitive.Root>
      <ConfirmDialog
        open={confirmOpen}
        title="Несохранённые изменения"
        description="Есть несохранённые изменения. Точно хотите выйти или остаться?"
        confirmLabel="Выйти"
        cancelLabel="Остаться"
        extraAction={
          canSaveAndExit
            ? {
                label: "Сохранить и выйти",
                onClick: () => void saveAndExit(),
                isPending: saving,
              }
            : undefined
        }
        overlayClassName="z-[100]"
        className="z-[100]"
        onOpenChange={setConfirmOpen}
        onConfirm={closeSheet}
      />
    </SheetDirtyContext.Provider>
  )
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  style,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  const layer = React.useContext(SheetLayerContext)
  const topLevel = React.useContext(SheetTopLevelContext)
  const covered = topLevel > layer
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        covered && "pointer-events-none opacity-0",
        className
      )}
      style={{ zIndex: sheetZIndex(layer), ...style }}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  actions,
  style,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  /** Под крестиком столбиком: удалить, затем редактировать. */
  actions?: React.ReactNode
}) {
  const layer = React.useContext(SheetLayerContext)
  const topLevel = React.useContext(SheetTopLevelContext)
  const coveredBy = Math.max(0, topLevel - layer)
  const peekRem = side === "right" ? Math.min(coveredBy, 2) * SHEET_PEEK_REM : 0
  const baseMax = sheetBaseMaxToken(className)
  // Inline style: динамический Tailwind-класс не попадает в CSS. Правый край остаётся right:0.
  const peekStyle =
    peekRem > 0 && baseMax
      ? { maxWidth: `min(96vw, calc(${baseMax} + ${peekRem}rem))` }
      : null
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-sheet-covered={coveredBy > 0 ? String(coveredBy) : undefined}
        className={cn(
          "fixed flex flex-col gap-4 bg-background shadow-lg transition-[max-width] duration-200 ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-500",
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className
        )}
        style={{
          zIndex: sheetZIndex(layer),
          ...peekStyle,
          ...style,
        }}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null
          if (
            target?.closest?.('[data-slot="dialog-content"]') ||
            target?.closest?.('[data-slot="dialog-overlay"]')
          ) {
            event.preventDefault()
          }
          onInteractOutside?.(event)
        }}
        {...props}
      >
        {children}
        {(actions || showCloseButton) && (
          <div className="absolute top-3 right-3 z-10 flex flex-col items-center gap-0.5">
            {showCloseButton ? (
              <SheetPrimitive.Close className="flex size-8 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:bg-muted hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary">
                <XIcon className="size-4" />
                <span className="sr-only">Закрыть</span>
              </SheetPrimitive.Close>
            ) : null}
            {actions}
          </div>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetLayer,
  SheetStackMeta,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
