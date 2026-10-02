import { useState } from 'react'

import { EntityPhotoStrip } from '@/components/shared/EntityPhotoStrip'
import {
  ImageGalleryGrid,
  ImageLightbox,
  type ImageLightboxItem,
} from '@/components/shared/ImageLightbox'
import { LoadingState } from '@/components/shared/LoadingState'

import { emptyToNull } from '../classification'
import { useReferenceItemPhotos } from '../hooks/use-reference-item-photos'

type DeviceTypePhotosReadonlyProps = {
  modelId: string | null | undefined
  modificationId: string | null | undefined
}

/** Фото вида прибора (модификация → модель), только просмотр. */
export function DeviceTypePhotosReadonly({
  modelId,
  modificationId,
}: DeviceTypePhotosReadonlyProps) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)

  const modId = emptyToNull(modificationId ?? null)
  const mdlId = emptyToNull(modelId ?? null)
  const primaryId = modId ?? mdlId
  const fallbackId = modId && mdlId && modId !== mdlId ? mdlId : null

  const primaryQuery = useReferenceItemPhotos(primaryId ?? undefined)
  const fallbackQuery = useReferenceItemPhotos(fallbackId ?? undefined)

  const source =
    (primaryQuery.data?.length ?? 0) > 0
      ? primaryQuery.data
      : (fallbackQuery.data ?? primaryQuery.data ?? [])

  const lightboxItems: ImageLightboxItem[] = (source ?? [])
    .filter((photo) => photo.signedUrl)
    .map((photo) => ({
      id: photo.id,
      src: photo.signedUrl as string,
      alt: photo.fileName || 'Фото',
      title: photo.fileName || 'Фото',
    }))

  const loading =
    Boolean(primaryId) &&
    (primaryQuery.isLoading || (Boolean(fallbackId) && fallbackQuery.isLoading && !primaryQuery.data?.length))

  if (!primaryId) {
    return null
  }

  if (loading) {
    return <LoadingState label="Загрузка фото" className="min-h-[14rem] py-8" />
  }

  return (
    <>
      <EntityPhotoStrip
        canEdit={false}
        photos={lightboxItems}
        uploading={false}
        onAdd={() => undefined}
        onOpen={(index) => setViewerIndex(index)}
        onOpenGallery={() => setGalleryOpen(true)}
      />

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
      />
    </>
  )
}
