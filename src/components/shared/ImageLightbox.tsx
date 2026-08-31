import { ChevronLeft, ChevronRight, Download, Link, RotateCcw, SquareArrowOutUpRight, Trash2, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

export type ImageLightboxItem = {
  id?: string
  src: string
  alt?: string
  title?: string
}

type ImageLightboxProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ImageLightboxItem[]
  index?: number
  onIndexChange?: (index: number) => void
  onDelete?: (item: ImageLightboxItem) => Promise<void> | void
}

export function ImageLightbox({
  open,
  onOpenChange,
  items,
  index = 0,
  onIndexChange,
  onDelete,
}: ImageLightboxProps) {
  const [rotation, setRotation] = useState(0)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const current = items[Math.min(index, Math.max(items.length - 1, 0))]

  useEffect(() => {
    setRotation(0)
    setCopied(false)
  }, [index, current?.src])

  useEffect(() => {
    if (!open) {
      setConfirmDelete(false)
      setRotation(0)
      setCopied(false)
    }
  }, [open])

  useEffect(() => {
    if (open && items.length === 0) {
      onOpenChange(false)
    }
  }, [items.length, onOpenChange, open])

  useEffect(() => {
    if (!open || items.length === 0 || index < items.length) {
      return
    }
    onIndexChange?.(items.length - 1)
  }, [index, items.length, onIndexChange, open])

  useEffect(() => {
    if (!open || items.length < 2) {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        const next = (index + 1) % items.length
        onIndexChange?.(next)
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        const next = (index - 1 + items.length) % items.length
        onIndexChange?.(next)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, items.length, onIndexChange, open])

  if (!current) {
    return null
  }

  const title = current.title || current.alt || 'Фото'
  const canNavigate = items.length > 1 && onIndexChange
  const sideways = rotation % 180 !== 0

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(current.src)
      setCopied(true)
      toast.success('Ссылка скопирована')
      window.setTimeout(() => setCopied(false), 1600)
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Не удалось скопировать ссылку.')
    }
  }

  async function downloadFile() {
    try {
      const response = await fetch(current.src)
      if (!response.ok) {
        throw new Error('Не удалось скачать файл.')
      }
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = title
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(href)
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Не удалось скачать файл.')
    }
  }

  async function confirmRemove() {
    if (!onDelete) {
      return
    }
    setDeleting(true)
    try {
      await onDelete(current)
      setConfirmDelete(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && confirmDelete) {
            return
          }
          onOpenChange(next)
        }}
      >
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/80"
          className="max-h-[96vh] w-auto max-w-[min(96vw,80rem)] border-0 bg-transparent p-0 shadow-none sm:max-w-[min(96vw,80rem)]"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (confirmDelete) {
              event.preventDefault()
            }
          }}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Просмотр фотографии. Escape — закрыть, стрелки — следующее и предыдущее.
          </DialogDescription>
          <div className="relative flex max-h-[96vh] flex-col items-center">
            <button
              type="button"
              className="absolute top-0 right-0 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              aria-label="Закрыть"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-5" />
            </button>
            {canNavigate ? (
              <>
                <button
                  type="button"
                  className="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                  aria-label="Предыдущее фото"
                  onClick={() => onIndexChange((index - 1 + items.length) % items.length)}
                >
                  <ChevronLeft className="size-6" />
                </button>
                <button
                  type="button"
                  className="absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                  aria-label="Следующее фото"
                  onClick={() => onIndexChange((index + 1) % items.length)}
                >
                  <ChevronRight className="size-6" />
                </button>
              </>
            ) : null}
            <img
              src={current.src}
              alt={current.alt || ''}
              draggable={false}
              style={{ transform: `rotate(${rotation}deg)` }}
              className={cn(
                'rounded-md object-contain transition-transform duration-200',
                sideways ? 'max-h-[min(90vw,70vh)] max-w-[min(88vh,92vw)]' : 'max-h-[min(88vh,calc(96vh-9rem))] max-w-full',
              )}
            />
            <p className="mt-3 max-w-full truncate px-8 text-center text-sm text-white">
              {title}
              {canNavigate ? ` · ${index + 1} / ${items.length}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1 rounded-lg bg-black/55 px-1.5 py-1 text-white">
              <ViewerAction
                label="Открыть"
                icon={<SquareArrowOutUpRight className="size-4" />}
                onClick={() => window.open(current.src, '_blank', 'noopener,noreferrer')}
              />
              <ViewerAction
                label="Копировать ссылку"
                icon={<Link className="size-4" />}
                active={copied}
                onClick={() => void copyLink()}
              />
              <ViewerAction
                label="Повернуть"
                icon={<RotateCcw className="size-4" />}
                onClick={() => setRotation((value) => (value + 270) % 360)}
              />
              <ViewerAction
                label="Скачать"
                icon={<Download className="size-4" />}
                onClick={() => void downloadFile()}
              />
              {onDelete ? (
                <ViewerAction
                  label="Удалить"
                  icon={<Trash2 className="size-4" />}
                  danger
                  onClick={() => setConfirmDelete(true)}
                />
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        title="Удалить файл"
        description={`${title} будет удалён из заказа.`}
        confirmLabel="Удалить"
        isPending={deleting}
        overlayClassName="z-[80]"
        className="z-[80]"
        onOpenChange={setConfirmDelete}
        onConfirm={() => void confirmRemove()}
      />
    </>
  )
}

function ViewerAction({
  label,
  icon,
  onClick,
  active = false,
  danger = false,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  active?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors',
        active
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : danger
            ? 'text-white hover:bg-red-600/80'
            : 'text-white hover:bg-white/15',
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

type ImageHoverPreviewProps = {
  src: string
  alt?: string
  children: ReactNode
}

export function ImageHoverPreview({ src, alt, children }: ImageHoverPreviewProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  function hide() {
    window.clearTimeout(timerRef.current)
    setOpen(false)
  }

  function show() {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      const width = 288
      const height = 220
      const gap = 12
      let left = rect.right + gap
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, rect.left - width - gap)
      }
      let top = rect.top
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - height - 8)
      }
      setCoords({ top, left })
      setOpen(true)
    }, 280)
  }

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  return (
    <span
      ref={triggerRef}
      className="inline-flex min-w-0"
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={hide}
    >
      {children}
      {open
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[60] overflow-hidden rounded-lg border bg-background p-1.5 shadow-xl"
              style={{ top: coords.top, left: coords.left }}
            >
              <img src={src} alt={alt || ''} className="max-h-52 max-w-72 rounded-md object-contain" />
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

type OpenableImageProps = {
  src: string
  alt: string
  title?: string
  className?: string
}

export function OpenableImage({ src, alt, title, className }: OpenableImageProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <ImageHoverPreview src={src} alt={alt}>
        <button
          type="button"
          className="block cursor-zoom-in rounded-md"
          aria-label={`Открыть «${alt || title || 'фото'}»`}
          onClick={() => setOpen(true)}
        >
          <img src={src} alt={alt} draggable={false} className={cn('rounded-md object-cover', className)} />
        </button>
      </ImageHoverPreview>
      <ImageLightbox
        open={open}
        onOpenChange={setOpen}
        items={[{ src, alt, title: title || alt }]}
      />
    </>
  )
}
