import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, WandSparkles } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import type { UseFormReturn } from 'react-hook-form'

import { ImageLightbox, type ImageLightboxItem } from '@/components/shared/ImageLightbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  barcodeTypeLabels,
  BARCODE_TYPES,
  generateBarcodeValue,
  isBarcodeType,
  labelPayload,
  renderLinearBarcode,
  type BarcodeType,
} from '@/lib/constants/barcode'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import {
  useDeleteInventoryItemPhoto,
  useInventoryItemPhotos,
  useSetInventoryItemLabel,
  useUploadInventoryItemPhoto,
} from '../hooks/use-inventory'
import type { InventoryItemFormValues } from '../schemas'
import { INVENTORY_ITEM_PHOTO_ACCEPT, type InventoryItem } from '../services/inventory-service'

type ItemMediaLabelProps = {
  item: InventoryItem
  form: UseFormReturn<InventoryItemFormValues>
  canEdit: boolean
}

export function ItemMediaLabel({ item, form, canEdit }: ItemMediaLabelProps) {
  const barcode = form.watch('barcode')
  const [barcodeType, setBarcodeType] = useState<BarcodeType>(() =>
    isBarcodeType(item.barcodeType) ? item.barcodeType : 'code128',
  )
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const photosQuery = useInventoryItemPhotos(item.id)
  const upload = useUploadInventoryItemPhoto(item.id)
  const removePhoto = useDeleteInventoryItemPhoto(item.id)
  const setLabel = useSetInventoryItemLabel(item.id)

  useEffect(() => {
    if (isBarcodeType(item.barcodeType)) {
      setBarcodeType(item.barcodeType)
    }
  }, [item.barcodeType])

  const payload = labelPayload(barcode, form.watch('code') || item.code)
  const photos = photosQuery.data ?? []
  const lightboxItems: ImageLightboxItem[] = photos
    .filter((photo) => photo.signedUrl)
    .map((photo) => ({
      id: photo.id,
      src: photo.signedUrl as string,
      alt: photo.fileName || 'Фото',
      title: photo.fileName || 'Фото',
    }))

  async function persistLabel(nextBarcode: string, nextType: BarcodeType) {
    if (!canEdit) {
      return
    }
    try {
      await setLabel.mutateAsync({ barcode: nextBarcode, barcodeType: nextType })
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    event.target.value = ''
    if (!files?.length) {
      return
    }
    try {
      for (const file of Array.from(files)) {
        await upload.mutateAsync(file)
      }
      toast.success(files.length === 1 ? 'Фото добавлено' : `Добавлено фото: ${files.length}`)
    } catch (error) {
      const message = getErrorMessage(error)
      if (/function|relation|bucket|does not exist|404|PGRST/i.test(message)) {
        toast.error('Фото не настроены в базе. Примените миграцию inventory_item_photos_label.')
        return
      }
      toast.error(message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)]">
        <PhotoStrip
          canEdit={canEdit}
          photos={lightboxItems}
          uploading={upload.isPending}
          onAdd={() => fileInput.current?.click()}
          onOpen={(index) => setViewerIndex(index)}
        />
        <LabelPreviewCard
          canEdit={canEdit}
          barcodeType={barcodeType}
          barcode={barcode}
          payload={payload}
          itemName={item.name}
          onTypeChange={(next) => {
            setBarcodeType(next)
            void persistLabel(barcode, next)
          }}
          onBarcodeChange={(next) => form.setValue('barcode', next, { shouldDirty: true })}
          onBarcodeBlur={() => void persistLabel(barcode, barcodeType)}
          onGenerate={() => {
            const next = generateBarcodeValue(barcodeType)
            form.setValue('barcode', next, { shouldDirty: true })
            void persistLabel(next, barcodeType)
          }}
        />
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={INVENTORY_ITEM_PHOTO_ACCEPT}
        multiple
        className="sr-only"
        onChange={(event) => void onFiles(event)}
      />

      <ImageLightbox
        open={viewerIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewerIndex(null)
          }
        }}
        items={lightboxItems}
        index={viewerIndex ?? 0}
        onIndexChange={setViewerIndex}
        onDelete={
          canEdit
            ? async (entry) => {
                if (!entry.id) {
                  return
                }
                const photo = photos.find((row) => row.id === entry.id)
                await removePhoto.mutateAsync({ id: entry.id, filePath: photo?.filePath ?? null })
                toast.success('Фото удалено')
              }
            : undefined
        }
      />
    </div>
  )
}

function PhotoStrip({
  canEdit,
  photos,
  uploading,
  onAdd,
  onOpen,
}: {
  canEdit: boolean
  photos: ImageLightboxItem[]
  uploading: boolean
  onAdd: () => void
  onOpen: (index: number) => void
}) {
  const SIDE_SLOTS = 3
  const main = photos[0]
  const rest = photos.slice(1)
  const overflow = Math.max(0, rest.length - SIDE_SLOTS)
  const sidePhotos = overflow > 0 ? rest.slice(0, SIDE_SLOTS - 1) : rest.slice(0, SIDE_SLOTS)
  const overflowPhoto = overflow > 0 ? rest[SIDE_SLOTS - 1] : null
  const hiddenCount = overflow > 0 ? rest.length - (SIDE_SLOTS - 1) : 0

  if (!main) {
    return (
      <button
        type="button"
        disabled={!canEdit || uploading}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (canEdit) {
            onAdd()
          }
        }}
        className={cn(
          'flex h-full min-h-[14rem] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 text-muted-foreground transition',
          canEdit && 'hover:border-foreground/30 hover:bg-background hover:text-foreground',
          uploading && 'opacity-60',
        )}
      >
        <Camera className="size-7 opacity-80" />
        <span className="text-sm font-medium">{uploading ? 'Загрузка…' : 'Добавить фото'}</span>
        {canEdit ? (
          <span className="text-[11px] text-muted-foreground">JPEG, PNG или WebP</span>
        ) : (
          <span className="text-sm">Нет фото</span>
        )}
      </button>
    )
  }

  return (
    <div className="grid h-full min-h-[14rem] grid-cols-[minmax(0,1fr)_3.25rem] gap-1.5 rounded-lg border border-dashed bg-muted/20 p-1.5">
      <div className="group relative min-h-0 overflow-hidden rounded-md border bg-background">
        <button type="button" className="absolute inset-0" onClick={() => onOpen(0)} aria-label="Открыть фото">
          <img src={main.src} alt={main.alt ?? ''} className="size-full object-cover" draggable={false} />
          <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
        </button>
        {canEdit ? (
          <button
            type="button"
            disabled={uploading}
            className="absolute bottom-1.5 left-1.5 z-[1] inline-flex items-center gap-1 rounded-md border bg-background/95 px-1.5 py-1 text-[11px] font-medium shadow-sm"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onAdd()
            }}
          >
            <ImagePlus className="size-3.5" />
            {uploading ? '…' : 'Ещё'}
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col gap-1.5">
        {sidePhotos.map((photo, index) => (
          <button
            key={photo.id ?? photo.src}
            type="button"
            className="group relative min-h-0 flex-1 overflow-hidden rounded-md border bg-background"
            onClick={() => onOpen(index + 1)}
          >
            <img src={photo.src} alt={photo.alt ?? ''} className="size-full object-cover" draggable={false} />
            <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
          </button>
        ))}
        {overflowPhoto ? (
          <button
            type="button"
            className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-background"
            onClick={() => onOpen(1 + sidePhotos.length)}
          >
            <img
              src={overflowPhoto.src}
              alt={overflowPhoto.alt ?? ''}
              className="size-full object-cover"
              draggable={false}
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
              +{hiddenCount}
            </span>
          </button>
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

function LabelPreviewCard({
  canEdit,
  barcodeType,
  barcode,
  payload,
  itemName,
  onTypeChange,
  onBarcodeChange,
  onBarcodeBlur,
  onGenerate,
}: {
  canEdit: boolean
  barcodeType: BarcodeType
  barcode: string
  payload: string
  itemName: string
  onTypeChange: (type: BarcodeType) => void
  onBarcodeChange: (value: string) => void
  onBarcodeBlur: () => void
  onGenerate: () => void
}) {
  return (
    <div className="flex h-full min-h-[14rem] flex-col gap-2 rounded-lg border bg-card p-2.5 shadow-sm">
      <div className="flex shrink-0 items-center gap-2">
        <Label className="sr-only">Тип</Label>
        <Select
          value={barcodeType}
          disabled={!canEdit}
          onValueChange={(value) => {
            if (isBarcodeType(value)) {
              onTypeChange(value)
            }
          }}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label="Тип штрихкода">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BARCODE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {barcodeTypeLabels[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Сгенерировать код"
            title="Сгенерировать код"
            onClick={onGenerate}
          >
            <WandSparkles className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-white p-2 text-black">
        <p className="line-clamp-2 shrink-0 text-center text-[11px] font-medium leading-tight">
          {itemName}
        </p>
        <div className="mt-1 flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <BarcodeGlyph type={barcodeType} payload={payload} />
        </div>
      </div>

      <Input
        value={barcode}
        disabled={!canEdit}
        placeholder="Значение штрихкода"
        className="h-8 shrink-0 truncate font-mono text-xs"
        inputMode={barcodeType === 'code128' || barcodeType === 'qr' ? 'text' : 'numeric'}
        onChange={(event) => onBarcodeChange(event.target.value)}
        onBlur={onBarcodeBlur}
        aria-label="Значение штрихкода"
      />
    </div>
  )
}

function BarcodeGlyph({ type, payload }: { type: BarcodeType; payload: string }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (type !== 'qr' || !payload) {
      setQrUrl(null)
      return
    }
    void QRCode.toDataURL(payload, {
      margin: 1,
      width: 256,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(
      (url) => {
        if (!cancelled) {
          setQrUrl(url)
        }
      },
      () => {
        if (!cancelled) {
          setQrUrl(null)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [type, payload])

  if (!payload) {
    return <p className="text-[11px] text-neutral-400">Нет значения</p>
  }

  if (type === 'qr') {
    if (!qrUrl) {
      return <p className="text-[11px] text-neutral-400">…</p>
    }
    return (
      <img
        src={qrUrl}
        alt={payload}
        className="max-h-full max-w-full object-contain"
      />
    )
  }

  const rendered = renderLinearBarcode(type, payload)
  if (rendered.kind === 'error') {
    return <p className="px-1 text-center text-[11px] text-red-600">{rendered.message}</p>
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col items-stretch justify-center gap-1 px-0.5">
      <svg
        role="img"
        aria-label={rendered.payload}
        viewBox={`0 0 ${rendered.width} ${rendered.height}`}
        className="min-h-0 w-full flex-1"
        preserveAspectRatio="none"
      >
        <path d={rendered.d} stroke="black" strokeWidth={1} fill="none" />
      </svg>
      <p className="shrink-0 truncate text-center font-mono text-[10px] leading-none tracking-normal text-black">
        {rendered.payload}
      </p>
    </div>
  )
}

/** Read-only media strip for viewers without edit rights. */
export function ItemMediaLabelReadonly({ item }: { item: InventoryItem }) {
  const photosQuery = useInventoryItemPhotos(item.id)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const barcodeType = isBarcodeType(item.barcodeType) ? item.barcodeType : 'code128'
  const payload = labelPayload(item.barcode, item.code)
  const photos = (photosQuery.data ?? [])
    .filter((photo) => photo.signedUrl)
    .map((photo) => ({
      id: photo.id,
      src: photo.signedUrl as string,
      alt: photo.fileName || 'Фото',
      title: photo.fileName || 'Фото',
    }))

  return (
    <div className="grid items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)]">
      <PhotoStrip
        canEdit={false}
        photos={photos}
        uploading={false}
        onAdd={() => undefined}
        onOpen={(index) => setViewerIndex(index)}
      />
      <div className="flex h-full min-h-[14rem] flex-col gap-2 rounded-lg border bg-card p-2.5 shadow-sm">
        <p className="shrink-0 text-xs text-muted-foreground">{barcodeTypeLabels[barcodeType]}</p>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-white p-2 text-black">
          <p className="line-clamp-2 shrink-0 text-center text-[11px] font-medium leading-tight">
            {item.name}
          </p>
          <div className="mt-1 flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <BarcodeGlyph type={barcodeType} payload={payload} />
          </div>
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">{item.barcode || '—'}</p>
      </div>
      <ImageLightbox
        open={viewerIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewerIndex(null)
          }
        }}
        items={photos}
        index={viewerIndex ?? 0}
        onIndexChange={setViewerIndex}
      />
    </div>
  )
}
