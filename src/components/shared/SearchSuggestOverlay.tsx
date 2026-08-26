import { useRef, type ReactNode } from 'react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type SearchSuggestOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  panel: ReactNode
}

export function SearchSuggestOverlay({ open, onOpenChange, children, panel }: SearchSuggestOverlayProps) {
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
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onPointerDownOutside={ignoreIfInsideAnchor}
        onInteractOutside={ignoreIfInsideAnchor}
        className={cn(
          'z-[80] w-[var(--radix-popper-anchor-width)] max-h-72 max-w-none overflow-hidden p-0',
        )}
      >
        {panel}
      </PopoverContent>
    </Popover>
  )
}
