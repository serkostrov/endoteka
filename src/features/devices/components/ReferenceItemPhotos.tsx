import { useState } from 'react'
import { toast } from 'sonner'

import { EntityPhotoStrip } from '@/components/shared/EntityPhotoStrip'
import {
  ImageGalleryGrid,
  ImageLightbox,
  type ImageLightboxItem,
} from '@/components/shared/ImageLightbox'
import { getErrorMessage } from '@/lib/errors'
import { pickImageFiles } from '@/lib/pick-image-files'

import {
  useDeleteReferenceItemPhoto,
  useReferenceItemPhotos,
  useSetReferenceItemPhotoCover,
  useUploadReferenceItemPhoto,
} from '../hooks/use-reference-item-photos'
import { REFERENCE_ITEM_PHOTO_ACCEPT } from '../services/reference-item-photos-service'

type ReferenceItemPhotosProps = {
  referenceItemId: string
  canEdit: boolean
}

export function ReferenceItemPhotos({ referenceItemId, canEdit }: ReferenceItemPhotosProps) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const photosQuery = useReferenceItemPhotos(referenceItemId)
  const upload = useUploadReferenceItemPhoto(referenceItemId)
  const removePhoto = useDeleteReferenceItemPhoto(referenceItemId)
  const setCover = useSetReferenceItemPhotoCover(referenceItemId)

  const photos = photosQuery.data ?? []
  const lightboxItems: ImageLightboxItem[] = photos
    .filter((photo) => photo.signedUrl)
    .map((photo) => ({
      id: photo.id,
      src: photo.signedUrl as string,
      alt: photo.fileName || 'Фото',
      title: photo.fileName || 'Фото',
    }))

  async function handleAddPhotos() {
    if (!canEdit || upload.isPending) {
      return
    }
    const files = await pickImageFiles({ accept: REFERENCE_ITEM_PHOTO_ACCEPT, multiple: true })
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
        toast.error('Фото не настроены в базе. Примените миграцию reference_item_photos.')
        return
      }
      if (/row-level security|policy|403|недостаточно прав/i.test(message)) {
        toast.error('Нет прав на загрузку фото (нужно settings:update).')
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
    <>
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
              }
            : undefined
        }
      />
    </>
  )
}
