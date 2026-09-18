import { forwardRef, useEffect, useRef, useState, type ComponentProps } from 'react'

import { cn } from '@/lib/utils'

type InlineTextInputProps = ComponentProps<'input'> & {
  /** content — ширина по тексту (шапка); fill — на всю ширину колонки (карточка). */
  fit?: 'content' | 'fill'
}

/** Текст до клика; по нажатию — правка и угловые ободки. */
export const InlineTextInput = forwardRef<HTMLInputElement, InlineTextInputProps>(
  function InlineTextInput(
    { className, value, placeholder, fit = 'content', style, disabled, onBlur, onFocus, onClick, type, ...props },
    ref,
  ) {
    const [active, setActive] = useState(false)
    const innerRef = useRef<HTMLInputElement | null>(null)
    const text = String(value ?? '')
    const hint = String(placeholder ?? '')
    const widthCh = Math.max(text.length, hint.length, 2) + 1

    useEffect(() => {
      if (!active) {
        return
      }
      const node = innerRef.current
      if (!node) {
        return
      }
      node.focus({ preventScroll: true })
      const len = node.value.length
      try {
        node.setSelectionRange(len, len)
      } catch {
        /* number inputs may not support selection */
      }
    }, [active])

    function setRefs(node: HTMLInputElement | null) {
      innerRef.current = node
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    }

    return (
      <input
        ref={setRefs}
        {...props}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={!active || Boolean(disabled)}
        autoComplete="off"
        data-slot="inline-text-input"
        data-active={active ? 'true' : undefined}
        style={fit === 'content' ? { width: `${widthCh}ch`, ...style } : style}
        className={cn(
          'm-0 h-[1.45em] min-h-[1.45em] cursor-text rounded-[2px] border-0 bg-transparent px-1 py-0.5 shadow-none outline-none ring-0',
          'text-inherit placeholder:text-muted-foreground/45',
          'read-only:caret-transparent',
          'hover:bg-muted/25',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:text-destructive',
          'focus-visible:ring-0 focus-visible:outline-none',
          type === 'number' &&
            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          fit === 'fill' && 'w-full min-w-0',
          className,
        )}
        onClick={(event) => {
          if (!disabled && !active) {
            setActive(true)
          }
          onClick?.(event)
        }}
        onFocus={(event) => {
          if (!disabled) {
            setActive(true)
          }
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setActive(false)
          onBlur?.(event)
        }}
      />
    )
  },
)
