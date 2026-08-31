import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { getErrorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

type SheetSaveFn = () => void | Promise<void>

type SheetDirtyContextValue = {
  setSourceDirty: (id: string, dirty: boolean, save?: SheetSaveFn | null) => void
}

const SheetDirtyContext = React.createContext<SheetDirtyContextValue | null>(null)

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

export async function runSheetFormSave<T>(
  handleSubmit: (onValid: (values: T) => Promise<void>) => (event?: unknown) => Promise<void>,
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
        overlayClassName="z-[80]"
        className="z-[80]"
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
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500",
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
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary">
            <XIcon className="size-4" />
            <span className="sr-only">Закрыть</span>
          </SheetPrimitive.Close>
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
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
