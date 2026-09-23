import { ChevronLeft, ChevronRight, Download, ImageIcon, Link, RotateCcw, SquareArrowOutUpRight, Trash2, X } from 'lucide-react'
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
  onSetCover?: (item: ImageLightboxItem) => Promise<void> | void
}

export function ImageLightbox({
  open,
  onOpenChange,
  items,
  index = 0,
  onIndexChange,
  onDelete,
  onSetCover,
}: ImageLightboxProps) {
  const [rotation, setRotation] = useState(0)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [settingCover, setSettingCover] = useState(false)
  const activeItem = items[Math.min(index, Math.max(items.length - 1, 0))]

  useEffect(() => {
    setRotation(0)
    setCopied(false)
  }, [index, activeItem?.src])

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

  if (!activeItem) {
    return null
  }

  const { src, alt, title: itemTitle } = activeItem
  const item = activeItem
  const title = itemTitle || alt || 'Фото'
  const canNavigate = items.length > 1 && onIndexChange
  const sideways = rotation % 180 !== 0

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(src)
      setCopied(true)
      toast.success('Ссылка скопирована')
      window.setTimeout(() => setCopied(false), 1600)
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Не удалось скопировать ссылку.')
    }
  }

  async function downloadFile() {
    try {
      const response = await fetch(src)
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
      await onDelete(item)
      setConfirmDelete(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  async function handleSetCover() {
    if (!onSetCover) {
      return
    }
    setSettingCover(true)
    try {
      await onSetCover(item)
      onIndexChange?.(0)
      toast.success('Обложка обновлена')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSettingCover(false)
    }
  }

  const canSetCover = Boolean(onSetCover && item.id && index > 0)

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
          className="fixed inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center border-0 bg-transparent p-0 shadow-none sm:max-w-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (confirmDelete) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event) => {
            if (confirmDelete) {
              event.preventDefault()
            }
          }}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Просмотр фотографии. Escape — закрыть, стрелки — следующее и предыдущее. Клик по пустому месту — закрыть.
          </DialogDescription>
          <div
            className="absolute inset-0 cursor-default"
            aria-hidden
            onClick={() => {
              if (!confirmDelete) {
                onOpenChange(false)
              }
            }}
          />
          <div
            className="relative z-10 flex max-h-[96vh] max-w-[min(96vw,80rem)] flex-col items-center"
            onClick={(event) => event.stopPropagation()}
          >
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
              src={src}
              alt={alt || ''}
              draggable={false}
              style={{ transform: `rotate(${rotation}deg)` }}
              className={cn(
                'rounded-md object-contain transition-transform duration-200',
                sideways
                  ? 'max-h-[min(90vw,62vh)] max-w-[min(88vh,92vw)]'
                  : 'max-h-[min(72vh,calc(96vh-12rem))] max-w-full',
              )}
            />
            <p className="mt-3 max-w-full truncate px-8 text-center text-sm text-white">
              {title}
              {canNavigate ? ` · ${index + 1} / ${items.length}` : ''}
            </p>
            {canNavigate ? (
              <div className="mt-3 flex max-w-[min(92vw,40rem)] gap-1.5 overflow-x-auto px-2 pb-1">
                {items.map((entry, thumbIndex) => (
                  <button
                    key={entry.id ?? `${entry.src}-${thumbIndex}`}
                    type="button"
                    aria-label={`Фото ${thumbIndex + 1}`}
                    aria-current={thumbIndex === index}
                    className={cn(
                      'size-14 shrink-0 overflow-hidden rounded-md border-2 transition',
                      thumbIndex === index
                        ? 'border-white shadow-md'
                        : 'border-transparent opacity-70 hover:opacity-100',
                    )}
                    onClick={() => onIndexChange(thumbIndex)}
                  >
                    <img
                      src={entry.src}
                      alt=""
                      draggable={false}
                      className="size-full object-cover"
                    />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1 rounded-lg bg-black/55 px-1.5 py-1 text-white">
              <ViewerAction
                label="Открыть"
                icon={<SquareArrowOutUpRight className="size-4" />}
                onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
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
              {canSetCover ? (
                <ViewerAction
                  label={settingCover ? 'Сохранение…' : 'Сделать обложкой'}
                  icon={<ImageIcon className="size-4" />}
                  onClick={() => void handleSetCover()}
                />
              ) : null}
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
  className?: string
  children: ReactNode
}

export function ImageHoverPreview({ src, alt, className, children }: ImageHoverPreviewProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 520, height: 420 })

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
      // Превью заметно крупнее исходного фото, но не больше окна.
      const width = Math.min(
        Math.max(rect.width * 1.75, 360),
        Math.min(560, window.innerWidth - 24),
      )
      const height = Math.min(
        Math.max(rect.height * 1.75, 280),
        Math.min(480, window.innerHeight - 24),
      )
      const gap = 12
      // Сначала справа от фото; если не влезает — слева; иначе у края экрана.
      let left = rect.right + gap
      if (left + width > window.innerWidth - 8) {
        left = rect.left - width - gap
      }
      if (left < 8) {
        left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left))
      }
      let top = rect.top + rect.height / 2 - height / 2
      if (top < 8) {
        top = 8
      }
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - height - 8)
      }
      setCoords({ top, left, width, height })
      setOpen(true)
    }, 220)
  }

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  return (
    <span
      ref={triggerRef}
      className={cn('inline-flex min-w-0', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[100] overflow-hidden rounded-lg border bg-background p-2 shadow-xl"
              style={{ top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.height }}
            >
              <img
                src={src}
                alt={alt || ''}
                className="h-full max-h-full w-full max-w-full rounded-md object-contain"
                style={{ maxHeight: coords.height - 16, maxWidth: coords.width - 16 }}
              />
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

type ImageGalleryGridProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ImageLightboxItem[]
  onSelect: (index: number) => void
  title?: string
}

/** Сетка всех фото — удобно открывать по «+N» в превью галереи. */
export function ImageGalleryGrid({
  open,
  onOpenChange,
  items,
  onSelect,
  title = 'Все фото',
}: ImageGalleryGridProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(90vh,44rem)] w-[min(96vw,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[40rem]"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base font-semibold">
              {title}
              {items.length > 0 ? ` · ${items.length}` : ''}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Выберите фото, чтобы открыть крупно.
            </DialogDescription>
          </div>
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Закрыть"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Фото пока нет</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((item, index) => (
                <button
                  key={item.id ?? `${item.src}-${index}`}
                  type="button"
                  className="group relative aspect-square overflow-hidden rounded-lg border bg-muted outline-none transition hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    onSelect(index)
                    onOpenChange(false)
                  }}
                  aria-label={item.alt || item.title || `Фото ${index + 1}`}
                >
                  <img
                    src={item.src}
                    alt=""
                    draggable={false}
                    className="size-full object-cover transition duration-200 group-hover:scale-[1.03]"
                  />
                  {index === 0 ? (
                    <span className="absolute top-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      Обложка
                    </span>
                  ) : null}
                  <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
                    {index + 1}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
