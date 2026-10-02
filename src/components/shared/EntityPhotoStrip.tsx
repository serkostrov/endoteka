import { Camera, ImagePlus } from 'lucide-react'

import { ImageHoverPreview, type ImageLightboxItem } from '@/components/shared/ImageLightbox'
import { cn } from '@/lib/utils'

type EntityPhotoStripProps = {
  canEdit: boolean
  photos: ImageLightboxItem[]
  uploading: boolean
  onAdd: () => void
  onOpen: (index: number) => void
  onOpenGallery?: () => void
  onSetCover?: (photo: ImageLightboxItem) => void
  className?: string
}

/** Полоса фото как у номенклатуры: обложка + боковые превью. */
export function EntityPhotoStrip({
  canEdit,
  photos,
  uploading,
  onAdd,
  onOpen,
  onOpenGallery,
  onSetCover,
  className,
}: EntityPhotoStripProps) {
  const SIDE_SLOTS = 3
  const main = photos[0]
  const rest = photos.slice(1)
  const overflow = Math.max(0, rest.length - SIDE_SLOTS)
  const sidePhotos = overflow > 0 ? rest.slice(0, SIDE_SLOTS - 1) : rest.slice(0, SIDE_SLOTS)
  const overflowPhoto = overflow > 0 ? rest[SIDE_SLOTS - 1] : null
  const hiddenCount = overflow > 0 ? rest.length - (SIDE_SLOTS - 1) : 0

  if (!main) {
    const emptyClass = cn(
      'flex h-full min-h-[14rem] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 text-muted-foreground',
      canEdit && 'transition hover:border-foreground/30 hover:bg-background hover:text-foreground',
      uploading && 'opacity-60',
      className,
    )

    if (!canEdit) {
      return (
        <div className={emptyClass} aria-label="Нет фото">
          <Camera className="size-7 opacity-80" />
          <span className="text-sm font-medium">Нет фото</span>
        </div>
      )
    }

    return (
      <button
        type="button"
        disabled={uploading}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onAdd()
        }}
        className={emptyClass}
      >
        <Camera className="size-7 opacity-80" />
        <span className="text-sm font-medium">{uploading ? 'Загрузка…' : 'Добавить фото'}</span>
        <span className="text-[11px] text-muted-foreground">JPEG, PNG или WebP</span>
      </button>
    )
  }

  return (
    <div
      className={cn(
        'grid h-full min-h-[14rem] grid-cols-[minmax(0,1fr)_3.25rem] gap-1.5 rounded-lg border border-dashed bg-muted/20 p-1.5',
        className,
      )}
    >
      <PhotoTile
        photo={main}
        isCover
        canEdit={canEdit}
        uploading={uploading}
        onOpen={() => onOpen(0)}
        onAdd={onAdd}
        showAdd
      />

      <div className="flex min-h-0 flex-col gap-1.5">
        {sidePhotos.map((photo, index) => (
          <PhotoTile
            key={photo.id ?? photo.src}
            photo={photo}
            canEdit={canEdit}
            uploading={uploading}
            onOpen={() => onOpen(index + 1)}
            onSetCover={onSetCover}
            compact
          />
        ))}
        {overflowPhoto ? (
          <PhotoTile
            photo={overflowPhoto}
            canEdit={canEdit}
            uploading={uploading}
            onOpen={() => (onOpenGallery ? onOpenGallery() : onOpen(1 + sidePhotos.length))}
            compact
            overflowLabel={`+${hiddenCount}`}
            disableHoverPreview
          />
        ) : null}
        {canEdit && rest.length < SIDE_SLOTS ? (
          <button
            type="button"
            disabled={uploading}
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed text-muted-foreground transition hover:border-foreground/30 hover:bg-background hover:text-foreground disabled:opacity-60"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onAdd()
            }}
            aria-label="Добавить фото"
          >
            <ImagePlus className="size-3.5" />
          </button>
        ) : null}
        {Array.from({
          length: Math.max(
            0,
            SIDE_SLOTS -
              sidePhotos.length -
              (overflowPhoto ? 1 : 0) -
              (canEdit && rest.length < SIDE_SLOTS ? 1 : 0),
          ),
        }).map((_, index) => (
          <div key={`pad-${index}`} className="min-h-0 flex-1" aria-hidden />
        ))}
      </div>
    </div>
  )
}

function PhotoTile({
  photo,
  isCover = false,
  canEdit,
  uploading,
  onOpen,
  onAdd,
  onSetCover,
  showAdd = false,
  compact = false,
  overflowLabel,
  disableHoverPreview = false,
}: {
  photo: ImageLightboxItem
  isCover?: boolean
  canEdit: boolean
  uploading: boolean
  onOpen: () => void
  onAdd?: () => void
  onSetCover?: (photo: ImageLightboxItem) => void
  showAdd?: boolean
  compact?: boolean
  overflowLabel?: string
  disableHoverPreview?: boolean
}) {
  const imageButton = (
    <button
      type="button"
      className={cn('relative size-full min-h-0', !compact && 'absolute inset-0')}
      onClick={onOpen}
      aria-label={overflowLabel ? `Показать все фото (${overflowLabel})` : 'Открыть фото'}
    >
      <img
        src={photo.src}
        alt={photo.alt ?? ''}
        className="size-full object-cover"
        draggable={false}
      />
      <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
      {overflowLabel ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/60 text-white transition group-hover:bg-black/70">
          <span className="text-sm font-semibold tabular-nums">{overflowLabel}</span>
          <span className="text-[9px] font-medium tracking-wide uppercase opacity-90">все</span>
        </span>
      ) : null}
    </button>
  )

  return (
    <div
      className={cn(
        'group relative min-h-0 overflow-hidden rounded-md border bg-background',
        compact ? 'flex flex-1' : 'min-h-0',
      )}
    >
      {disableHoverPreview ? (
        <div className={cn(compact ? 'flex min-h-0 flex-1' : 'absolute inset-0 block size-full')}>
          {imageButton}
        </div>
      ) : (
        <ImageHoverPreview
          src={photo.src}
          alt={photo.alt ?? 'Фото'}
          className={cn(compact ? 'flex min-h-0 flex-1' : 'absolute inset-0 block size-full')}
        >
          {imageButton}
        </ImageHoverPreview>
      )}
      {isCover ? (
        <span className="pointer-events-none absolute top-1.5 left-1.5 z-[1] rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Обложка
        </span>
      ) : null}
      {showAdd && canEdit ? (
        <button
          type="button"
          disabled={uploading}
          className="absolute bottom-1.5 left-1.5 z-[1] inline-flex items-center gap-1 rounded-md border bg-background/95 px-1.5 py-1 text-[11px] font-medium shadow-sm"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onAdd?.()
          }}
        >
          <ImagePlus className="size-3.5" />
          {uploading ? '…' : 'Ещё'}
        </button>
      ) : null}
      {canEdit && !isCover && onSetCover && !overflowLabel ? (
        <button
          type="button"
          disabled={uploading}
          className={cn(
            'absolute z-[1] rounded-md border bg-background/95 text-[10px] font-medium shadow-sm transition-opacity',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            compact ? 'inset-x-0.5 bottom-0.5 px-0.5 py-0.5 leading-tight' : 'right-1.5 bottom-1.5 px-1.5 py-1',
          )}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSetCover(photo)
          }}
        >
          {compact ? 'Обложка' : 'Сделать обложкой'}
        </button>
      ) : null}
    </div>
  )
}
