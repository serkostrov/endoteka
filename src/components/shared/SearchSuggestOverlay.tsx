import { Plus } from 'lucide-react'
import { useRef, type ReactNode } from 'react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type SearchSuggestOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  panel: ReactNode
  contentClassName?: string
}

export function SearchSuggestOverlay({
  open,
  onOpenChange,
  children,
  panel,
  contentClassName,
}: SearchSuggestOverlayProps) {
  const anchorRef = useRef<HTMLDivElement>(null)

  function ignoreIfInsideAnchor(event: { target: EventTarget | null; preventDefault: () => void }) {
    const target = event.target
    if (target instanceof Node && anchorRef.current?.contains(target)) {
      event.preventDefault()
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="min-w-0 w-full">
          {children}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onPointerDownOutside={ignoreIfInsideAnchor}
        onInteractOutside={ignoreIfInsideAnchor}
        className={cn(
          'z-[80] flex w-[var(--radix-popper-anchor-width)] max-h-[min(24rem,var(--radix-popover-content-available-height))] max-w-none flex-col overflow-hidden p-0',
          contentClassName,
        )}
      >
        {panel}
      </PopoverContent>
    </Popover>
  )
}

export function SearchCreateAction({
  label = 'Новый',
  disabled,
  onCreate,
  className,
  /** comfortable — чуть выше (поиск приборов и клиентов) */
  size = 'default',
}: {
  label?: string
  disabled?: boolean
  onCreate: () => void
  className?: string
  size?: 'default' | 'comfortable'
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex w-full shrink-0 items-center gap-2 border-t px-3 text-left text-sm font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
        size === 'comfortable' ? 'py-2.5' : 'py-2',
        className,
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onCreate}
    >
      <Plus className="size-4 shrink-0" />
      {label}
    </button>
  )
}

export function SearchEmptyCreate({
  message,
  actionLabel = 'Новый',
  disabled,
  onCreate,
  actionSize = 'default',
}: {
  message: string
  actionLabel?: string
  disabled?: boolean
  onCreate?: () => void
  actionSize?: 'default' | 'comfortable'
}) {
  return (
    <div>
      <p className="px-3 py-3 text-sm text-muted-foreground">{message}</p>
      {onCreate ? (
        <SearchCreateAction
          label={actionLabel}
          disabled={disabled}
          onCreate={onCreate}
          size={actionSize}
        />
      ) : null}
    </div>
  )
}

