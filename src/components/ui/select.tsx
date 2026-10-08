"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex h-9 w-fit items-center justify-between gap-2 rounded-md border border-input bg-muted px-3 py-0 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function getNodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return ""
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(getNodeText).join("")
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getNodeText(node.props.children)
  }
  return ""
}

/**
 * Не удаляем пункты из DOM — только скрываем.
 * Иначе Radix Select теряет фокус / закрывается при первой букве в поиске.
 */
function filterSelectChildren(children: React.ReactNode, query: string): {
  nodes: React.ReactNode[]
  matchCount: number
} {
  const normalized = query.trim().toLocaleLowerCase("ru")
  let matchCount = 0

  const nodes = React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; value?: string; className?: string }>(child)) {
      return [child]
    }

    if (child.props.value != null) {
      const text = getNodeText(child.props.children)
      const matches = !normalized || text.toLocaleLowerCase("ru").includes(normalized)
      if (matches) {
        matchCount += 1
      }
      return [
        React.cloneElement(child, {
          className: cn(child.props.className, !matches && "hidden"),
        }),
      ]
    }

    const nested = filterSelectChildren(child.props.children, query)
    matchCount += nested.matchCount
    if (!normalized) {
      return [child]
    }
    return [
      React.cloneElement(child, undefined, nested.nodes),
    ]
  })

  return { nodes, matchCount }
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  searchable = false,
  searchPlaceholder = "Поиск…",
  /** false — не фильтровать пункты локально (поиск на сервере через onSearchChange). */
  filterLocally = true,
  onSearchChange,
  searchEmpty = false,
  onCloseAutoFocus,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  searchable?: boolean
  searchPlaceholder?: string
  filterLocally?: boolean
  onSearchChange?: (query: string) => void
  /** Показать «Ничего не найдено» при серверном поиске. */
  searchEmpty?: boolean
}) {
  const [query, setQuery] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const onSearchChangeRef = React.useRef(onSearchChange)
  onSearchChangeRef.current = onSearchChange

  React.useEffect(() => {
    if (!searchable) {
      return
    }
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [searchable])

  const setSearchQuery = React.useCallback((next: string) => {
    setQuery(next)
    onSearchChangeRef.current?.(next)
  }, [])

  const { nodes: displayed, matchCount } = React.useMemo(() => {
    if (!searchable) {
      return { nodes: React.Children.toArray(children), matchCount: -1 }
    }
    if (!filterLocally) {
      const nodes = React.Children.toArray(children)
      return { nodes, matchCount: nodes.length }
    }
    return filterSelectChildren(children, query)
  }, [children, filterLocally, query, searchable])

  const showEmpty =
    searchable &&
    ((filterLocally && matchCount === 0) || (!filterLocally && searchEmpty))

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "relative z-[110] max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          searchable ? "overflow-hidden" : "overflow-y-auto",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        {...props}
        onKeyDown={(event) => {
          // Typeahead Select не должен перехватывать ввод в поле поиска.
          if (searchable && event.target === inputRef.current) {
            event.stopPropagation()
          }
          onKeyDown?.(event)
        }}
        onCloseAutoFocus={(event) => {
          setSearchQuery("")
          onCloseAutoFocus?.(event)
        }}
      >
        {searchable ? (
          <div
            className="sticky top-0 z-10 border-b bg-popover p-1.5"
            onPointerDown={(event) => {
              // Не отдаём фокус пунктам списка / не закрываем Content.
              event.preventDefault()
              event.stopPropagation()
              inputRef.current?.focus()
            }}
          >
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                autoComplete="off"
                className="h-8 w-full rounded-md border border-input bg-muted pr-2 pl-7 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onChange={(event) => {
                  setSearchQuery(event.target.value)
                  window.requestAnimationFrame(() => inputRef.current?.focus())
                }}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Escape" && query) {
                    event.preventDefault()
                    setSearchQuery("")
                  }
                }}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          </div>
        ) : null}
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1",
            searchable && "max-h-60 overflow-y-auto overscroll-contain"
          )}
          onWheel={searchable ? (event) => event.stopPropagation() : undefined}
          onTouchMove={searchable ? (event) => event.stopPropagation() : undefined}
        >
          {showEmpty ? (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground" role="status">
              Ничего не найдено
            </div>
          ) : null}
          {displayed}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
