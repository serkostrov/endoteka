import { useEffect, useState } from 'react'
import { WandSparkles } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import type { UseFormReturn } from 'react-hook-form'

import { EntityPhotoStrip } from '@/components/shared/EntityPhotoStrip'
import { ImageLightbox, ImageGalleryGrid, type ImageLightboxItem } from '@/components/shared/ImageLightbox'
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
import { pickImageFiles } from '@/lib/pick-image-files'

import {
  useDeleteInventoryItemPhoto,
  useInventoryItemPhotos,
  useSetInventoryItemLabel,
  useSetInventoryItemPhotoCover,
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
  const [galleryOpen, setGalleryOpen] = useState(false)

  const photosQuery = useInventoryItemPhotos(item.id)
  const upload = useUploadInventoryItemPhoto(item.id)
  const removePhoto = useDeleteInventoryItemPhoto(item.id)
  const setCover = useSetInventoryItemPhotoCover(item.id)
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

  async function handleAddPhotos() {
    if (!canEdit || upload.isPending) {
      return
    }
    const files = await pickImageFiles({ accept: INVENTORY_ITEM_PHOTO_ACCEPT, multiple: true })
    if (!files.length) {
      return
    }
    try {
      for (const file of files) {
        await upload.mutateAsync(file)
      }
      toast.success(files.length === 1 ? 'Фото добавлено' : `Добавлено фото: ${files.length}`)
    } catch (error) {
      const message = getErrorMessage(error)
      if (/function|relation|bucket|does not exist|404|PGRST|schema cache/i.test(message)) {
        toast.error('Фото не настроены в базе. Примените миграцию inventory_item_photos_label / fix_photo_uploads.')
        return
      }
      if (/row-level security|policy|403|недостаточно прав/i.test(message)) {
        toast.error('Нет прав на загрузку фото (нужно inventory:receive).')
        return
      }
      toast.error(message)
    }
  }

  async function handleSetCover(photoId: string) {
    try {
      await setCover.mutateAsync(photoId)
      toast.success('Обложка обновлена')
      setViewerIndex(0)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)]">
        <EntityPhotoStrip
          canEdit={canEdit}
          photos={lightboxItems}
          uploading={upload.isPending || setCover.isPending}
          onAdd={() => void handleAddPhotos()}
          onOpen={(index) => setViewerIndex(index)}
          onOpenGallery={() => setGalleryOpen(true)}
          onSetCover={
            canEdit
              ? (photo) => {
                  if (photo.id) {
                    void handleSetCover(photo.id)
                  }
                }
              : undefined
          }
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

      <ImageGalleryGrid
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        items={lightboxItems}
        onSelect={(index) => setViewerIndex(index)}
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
        onSetCover={
          canEdit
            ? async (entry) => {
                if (!entry.id) {
                  return
                }
                await setCover.mutateAsync(entry.id)
              }
            : undefined
        }
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
    <div className="flex h-full min-h-[14rem] flex-col gap-2">
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
          <SelectContent searchable>
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
  const [galleryOpen, setGalleryOpen] = useState(false)
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
      <EntityPhotoStrip
        canEdit={false}
        photos={photos}
        uploading={false}
        onAdd={() => undefined}
        onOpen={(index) => setViewerIndex(index)}
        onOpenGallery={() => setGalleryOpen(true)}
      />
      <div className="flex h-full min-h-[14rem] flex-col gap-2">
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
      <ImageGalleryGrid
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        items={photos}
        onSelect={(index) => setViewerIndex(index)}
      />
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
