import { zodResolver } from '@hookform/resolvers/zod'
import { ExternalLink, FileText, Image } from 'lucide-react'
import { type ChangeEvent, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useHasPermission } from '@/features/auth'
import { ORDER_FILE_ACCEPT } from '@/lib/constants/orders'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { useAddOrderAttachmentUrl, useOrderAttachments, useUploadOrderFile } from '../hooks/use-orders'
import { attachmentUrlSchema, type AttachmentUrlFormValues } from '../schemas'
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
  const addUrl = useAddOrderAttachmentUrl(orderId)
  const fileInput = useRef<HTMLInputElement>(null)

  const form = useForm<AttachmentUrlFormValues>({
    resolver: zodResolver(attachmentUrlSchema),
    defaultValues: { url: '', caption: '' },
  })

  if (attachmentsQuery.isLoading) {
    return <LoadingState label="Загрузка вложений" />
  }

  if (attachmentsQuery.error) {
    return <ErrorState description={getErrorMessage(attachmentsQuery.error)} />
  }

  const items = attachmentsQuery.data ?? []

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    try {
      await upload.mutateAsync({ file, caption: '' })
      toast.success('Файл добавлен')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function onSubmitUrl(values: AttachmentUrlFormValues) {
    try {
      await addUrl.mutateAsync(values)
      toast.success('Ссылка добавлена')
      form.reset()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      {canAddFiles ? (
        <SectionCard title="Добавить" description="Фото и PDF загружаются в хранилище. Видео — только внешней ссылкой.">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={ORDER_FILE_ACCEPT}
              className="sr-only"
              onChange={(event) => void onFileChange(event)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {upload.isPending ? 'Загрузка…' : 'Прикрепить файл'}
            </Button>
          </div>
          <Form {...form}>
            <form className="mt-4 grid gap-3 md:grid-cols-[1fr_12rem_auto]" onSubmit={form.handleSubmit(onSubmitUrl)} noValidate>
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Внешняя ссылка</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="caption"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Подпись</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-end">
                <Button type="submit" disabled={addUrl.isPending}>
                  {addUrl.isPending ? 'Добавление…' : 'Добавить ссылку'}
                </Button>
              </div>
            </form>
          </Form>
        </SectionCard>
      ) : null}

      <SectionCard title="Файлы и ссылки">
        {items.length === 0 ? (
          <EmptyState title="Вложений нет" description="Добавьте фото, PDF или внешнюю ссылку." />
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <AttachmentRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}

function AttachmentRow({ item }: { item: OrderAttachment }) {
  const href = item.kind === 'url' ? item.url : item.signedUrl
  const Icon = item.kind === 'photo' ? Image : item.kind === 'pdf' ? FileText : ExternalLink

  return (
    <li className="flex items-start gap-3 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.fileName || item.caption || item.url || 'Вложение'}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
      </div>
      {href ? (
        <Button asChild variant="outline" size="sm">
          <a href={href} target="_blank" rel="noreferrer">
            Открыть
          </a>
        </Button>
      ) : null}
    </li>
  )
}
