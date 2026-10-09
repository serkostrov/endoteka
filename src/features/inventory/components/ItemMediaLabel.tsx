import { useCallback, useEffect, useState } from 'react'
import { Printer, WandSparkles } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import type { UseFormReturn } from 'react-hook-form'

import { EntityPhotoStrip } from '@/components/shared/EntityPhotoStrip'
import { ImageLightbox, ImageGalleryGrid, type ImageLightboxItem } from '@/components/shared/ImageLightbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import {
  barcodeTypeLabels,
  BARCODE_TYPES,
  generateBarcodeValue,
  isBarcodeType,
  labelPayload,
  renderLinearBarcode,
  type BarcodeType,
} from '@/lib/constants/barcode'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { pickImageFiles } from '@/lib/pick-image-files'

import {
  useDeleteInventoryItemPhoto,
  useInventoryItemPhotos,
  useSetInventoryItemLabel,
  useSetInventoryItemPhotoCover,
  useUploadInventoryItemPhoto,
} from '../hooks/use-inventory'
import { useRegisterItemLabelSnapshot } from '../lib/item-label-print-context'
import { itemLabelMetaLine, printItemLabels, toPrintableItemLabel } from '../lib/print-item-labels'
import type { InventoryItemFormValues } from '../schemas'
import { INVENTORY_ITEM_PHOTO_ACCEPT, type InventoryItem } from '../services/inventory-service'

type ItemMediaLabelProps = {
  item: InventoryItem
  form: UseFormReturn<InventoryItemFormValues>
  canEdit: boolean
}

export function ItemMediaLabel({ item, form, canEdit }: ItemMediaLabelProps) {
  const name = form.watch('name')
  const code = form.watch('code')
  const article = form.watch('article')
  const barcode = form.watch('barcode')
  const barcodeTypeRaw = form.watch('barcodeType')
  const barcodeType: BarcodeType = isBarcodeType(barcodeTypeRaw) ? barcodeTypeRaw : 'code128'

  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)

  const photosQuery = useInventoryItemPhotos(item.id)
  const upload = useUploadInventoryItemPhoto(item.id)
  const removePhoto = useDeleteInventoryItemPhoto(item.id)
  const setCover = useSetInventoryItemPhotoCover(item.id)
  const setLabel = useSetInventoryItemLabel(item.id)

  const getSnapshot = useCallback(
    () =>
      toPrintableItemLabel({
        name,
        code,
        article,
        barcode,
        barcodeType,
      }),
    [article, barcode, barcodeType, code, name],
  )

  useRegisterItemLabelSnapshot(getSnapshot)

  const payload = labelPayload(barcode)
  const metaLine = itemLabelMetaLine({ code, article })
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
          snapshot={getSnapshot()}
          onTypeChange={(next) => {
            form.setValue('barcodeType', next, { shouldDirty: true })
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
  snapshot,
  onTypeChange,
  onBarcodeChange,
  onBarcodeBlur,
  onGenerate,
}: {
  canEdit: boolean
  barcodeType: BarcodeType
  barcode: string
  payload: string
  snapshot: ReturnType<typeof toPrintableItemLabel>
  onTypeChange: (type: BarcodeType) => void
  onBarcodeChange: (value: string) => void
  onBarcodeBlur: () => void
  onGenerate: () => void
}) {
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const canReadDocs = useHasPermission(Permission.DocumentsRead)
  const canCreateDocs = useHasPermission(Permission.DocumentsCreate)
  const canPrintDocs = useHasPermission(Permission.DocumentsPrint)
  const canPrint = canReceive || canReadDocs || canCreateDocs || canPrintDocs
  const [printPending, setPrintPending] = useState(false)
  const metaLine = itemLabelMetaLine(snapshot)

  async function handlePrint() {
    setPrintPending(true)
    try {
      // Печать = точная копия превью (те же поля карточки).
      await printItemLabels([snapshot])
      toast.success('Этикетка отправлена на печать')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPrintPending(false)
    }
  }

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
        {canPrint ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={printPending ? 'Подготовка…' : 'Распечатать этикетку'}
            title="Распечатать этикетку"
            disabled={printPending}
            onClick={() => void handlePrint()}
          >
            <Printer className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-white p-2 text-black">
        <p className="line-clamp-2 shrink-0 text-center text-[11px] font-medium leading-tight">
          {snapshot.name || '—'}
        </p>
        {metaLine ? (
          <p className="mt-0.5 shrink-0 truncate text-center text-[9px] leading-tight text-neutral-700">
            {metaLine}
          </p>
        ) : null}
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
    return <p className="text-[11px] text-neutral-400">Нет штрихкода</p>
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
  const snapshot = toPrintableItemLabel(item)
  const barcodeType = isBarcodeType(snapshot.barcodeType) ? snapshot.barcodeType : 'code128'
  const payload = labelPayload(snapshot.barcode)
  const metaLine = itemLabelMetaLine(snapshot)

  useRegisterItemLabelSnapshot(() => snapshot)

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
            {snapshot.name || '—'}
          </p>
          {metaLine ? (
            <p className="mt-0.5 shrink-0 truncate text-center text-[9px] leading-tight text-neutral-700">
              {metaLine}
            </p>
          ) : null}
          <div className="mt-1 flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <BarcodeGlyph type={barcodeType} payload={payload} />
          </div>
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">{snapshot.barcode || '—'}</p>
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
