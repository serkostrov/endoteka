import { ExternalLink, FileText, Paperclip } from 'lucide-react'
import { type ChangeEvent, useRef, useState } from 'react'
import { toast } from 'sonner'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ImageHoverPreview, ImageLightbox, type ImageLightboxItem } from '@/components/shared/ImageLightbox'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useHasPermission } from '@/features/auth'
import { ORDER_FILE_ACCEPT } from '@/lib/constants/orders'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'
import { formatFileSize } from '@/lib/utils/file'

import { useDeleteOrderAttachment, useOrderAttachments, useUploadOrderFile } from '../hooks/use-orders'
import type { OrderAttachment } from '../services/orders-service'

type OrderAttachmentsTabProps = {
  orderId: string
}

export function OrderAttachmentsTab({ orderId }: OrderAttachmentsTabProps) {
  const canUpdate = useHasPermission(Permission.OrdersUpdate)
  const canCreate = useHasPermission(Permission.OrdersCreate)
  const canAddFiles = canUpdate || canCreate
  const attachmentsQuery = useOrderAttachments(orderId)
  const upload = useUploadOrderFile(orderId)
  const remove = useDeleteOrderAttachment(orderId)
  const fileInput = useRef<HTMLInputElement>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  if (attachmentsQuery.isLoading) {
    return <LoadingState label="Загрузка вложений" />
  }

  if (attachmentsQuery.error) {
    return <ErrorState description={getErrorMessage(attachmentsQuery.error)} />
  }

  const items = attachmentsQuery.data ?? []
  const photoItems = items.filter((item) => item.kind === 'photo' && item.signedUrl)
  const photos: ImageLightboxItem[] = photoItems.map((item) => ({
    id: item.id,
    src: item.signedUrl as string,
    alt: item.fileName || item.caption || 'Фото',
    title: item.fileName || item.caption || 'Фото',
  }))

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) {
      return
    }

    try {
      for (const file of list) {
        await upload.mutateAsync({ file, caption: '' })
      }
      toast.success(list.length === 1 ? 'Файл добавлен' : `Добавлено файлов: ${list.length}`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    event.target.value = ''
    if (files) {
      await uploadFiles(files)
    }
  }

  function openAttachment(item: OrderAttachment) {
    if (item.kind === 'photo' && item.signedUrl) {
      const index = photoItems.findIndex((entry) => entry.id === item.id)
      if (index >= 0) {
        setViewerIndex(index)
      }
      return
    }

    const href = item.kind === 'url' ? item.url : item.signedUrl
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }

  async function handleDeletePhoto(item: ImageLightboxItem) {
    if (!item.id) {
      return
    }
    const attachment = items.find((entry) => entry.id === item.id)
    await remove.mutateAsync({ id: item.id, filePath: attachment?.filePath ?? null })
    toast.success('Файл удалён')
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Файлы"
        description="Фото и PDF по этому заказу."
        actions={
          canAddFiles ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ORDER_FILE_ACCEPT}
                className="sr-only"
                onChange={(event) => void onFileChange(event)}
              />
              <Button
                type="button"
                disabled={upload.isPending}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip className="size-4" />
                {upload.isPending ? 'Загрузка…' : 'Прикрепить файл'}
              </Button>
            </div>
          ) : null
        }
      >
        {items.length === 0 ? (
          <EmptyState title="Вложений нет" description="Добавьте фото или PDF." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название файла</TableHead>
                  <TableHead>Загружено</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => openAttachment(item)}
                  >
                    <TableCell className="whitespace-normal">
                      {item.kind === 'photo' && item.signedUrl ? (
                        <ImageHoverPreview src={item.signedUrl} alt={item.fileName || item.caption || 'Фото'}>
                          <AttachmentRowPreview item={item} />
                        </ImageHoverPreview>
                      ) : (
                        <AttachmentRowPreview item={item} />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <p className="font-medium">{item.createdByName || '—'}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-muted-foreground mt-3 text-sm">Всего — {items.length}</p>
          </>
        )}
      </SectionCard>

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
        onDelete={canUpdate ? handleDeletePhoto : undefined}
      />
    </div>
  )
}

function AttachmentRowPreview({ item }: { item: OrderAttachment }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AttachmentThumb item={item} />
      <div className="min-w-0">
        <p className="truncate font-medium">{item.fileName || item.caption || item.url || 'Вложение'}</p>
        {item.fileSize ? (
          <p className="text-xs text-muted-foreground">{formatFileSize(item.fileSize)}</p>
        ) : item.kind === 'url' ? (
          <p className="truncate text-xs text-muted-foreground">{item.url}</p>
        ) : null}
      </div>
    </div>
  )
}

function AttachmentThumb({ item }: { item: OrderAttachment }) {
  if (item.kind === 'photo' && item.signedUrl) {
    return (
      <img
        src={item.signedUrl}
        alt=""
        draggable={false}
        className="size-12 shrink-0 rounded-md border object-cover"
      />
    )
  }

  if (item.kind === 'pdf') {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-red-600 text-[10px] font-bold text-white">
        PDF
      </div>
    )
  }

  return (
    <div className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-md border">
      {item.kind === 'url' ? <ExternalLink className="size-5" /> : <FileText className="size-5" />}
    </div>
  )
}
