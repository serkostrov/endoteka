import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { FileText, Paperclip } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { useHasPermission } from '@/features/auth'
import { useAddOrderJournalNote, useOrderJournal } from '@/features/diagnostics/hooks/use-diagnostics'
import { formatJournalValue, type OrderJournalEvent } from '@/features/diagnostics/services/diagnostics-service'
import { OrderJournalEventType } from '@/lib/constants/orders'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { toDate } from '@/lib/utils/date'
import type { Json } from '@/types/database'

import { useOrderAttachments, useUploadOrderFile } from '../hooks/use-orders'
import { orderJournalEventTypeLabel } from '../lib/journal-labels'
import type { OrderAttachment } from '../services/orders-service'
import { OrderJournalComposer } from './OrderJournalComposer'

type OrderActivityFeedProps = {
  orderId: string
}

export function OrderActivityFeed({ orderId }: OrderActivityFeedProps) {
  const canWrite =
    useHasPermission(Permission.OrdersUpdate) || useHasPermission(Permission.OrdersCreate)
  const historyQuery = useOrderJournal(orderId)
  const attachmentsQuery = useOrderAttachments(orderId)
  const addNote = useAddOrderJournalNote(orderId)
  const upload = useUploadOrderFile(orderId)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const events = useMemo(() => [...(historyQuery.data ?? [])].reverse(), [historyQuery.data])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [events])

  if (historyQuery.isLoading) {
    return <LoadingState label="Загрузка событий" className="min-h-32" />
  }

  if (historyQuery.error) {
    return <ErrorState description={getErrorMessage(historyQuery.error)} />
  }

  const groups = groupByDay(events)
  const attachments = new Map((attachmentsQuery.data ?? []).map((item) => [item.id, item]))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <p className="text-sm font-medium">Журнал</p>
        <p className="text-xs text-muted-foreground">Комментарии, статусы и файлы заказа</p>
      </div>
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {events.length === 0 ? (
          <EmptyState
            className="border-0 bg-transparent py-8"
            title="Событий нет"
            description="Напишите событие или прикрепите фото — запись появится здесь."
          />
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.label}>
                <h3 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.label}</h3>
                <ol className="relative space-y-4 border-l border-border pl-4">
                  {group.events.map((event) => (
                    <li key={event.id} className="relative">
                      <span className="absolute top-1.5 -left-5 size-2 rounded-full bg-primary" />
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-info/12 px-1.5 py-0.5 text-xs font-medium text-info">
                          {orderJournalEventTypeLabel(event.eventType)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {toDate(event.createdAt) ? format(toDate(event.createdAt) as Date, 'HH:mm') : ''}
                        </span>
                      </div>
                      <p
                        className={
                          event.eventType === OrderJournalEventType.Comment
                            ? 'text-sm whitespace-pre-wrap'
                            : 'text-sm'
                        }
                      >
                        {event.summary}
                      </p>
                      {event.actorName ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{event.actorName}</p>
                      ) : null}
                      {event.changes.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {event.changes.map((change) => (
                            <li key={`${event.id}-${change.field}`}>
                              {change.label}: {formatJournalValue(change.from)} → {formatJournalValue(change.to)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <JournalAttachmentPreview
                        event={event}
                        attachment={attachments.get(attachmentIdFromPayload(event.payload) ?? '')}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
      {canWrite ? (
        <OrderJournalComposer
          pending={addNote.isPending || upload.isPending}
          onSubmit={async ({ text, files }) => {
            for (const file of files) {
              await upload.mutateAsync({ file, caption: '' })
            }
            if (text) {
              await addNote.mutateAsync(text)
            }
          }}
        />
      ) : null}
    </div>
  )
}

function JournalAttachmentPreview({
  event,
  attachment,
}: {
  event: OrderJournalEvent
  attachment: OrderAttachment | undefined
}) {
  if (event.eventType !== OrderJournalEventType.Attachment) {
    return null
  }

  if (!attachment) {
    return null
  }

  if (attachment.kind === 'photo' && attachment.signedUrl) {
    return (
      <a className="mt-2 block w-fit" href={attachment.signedUrl} target="_blank" rel="noreferrer">
        <img
          src={attachment.signedUrl}
          alt={attachment.fileName || attachment.caption || 'Фото'}
          className="size-16 rounded-md object-cover"
        />
      </a>
    )
  }

  const href = attachment.kind === 'url' ? attachment.url : attachment.signedUrl
  if (!href) {
    return null
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      {attachment.kind === 'pdf' ? <FileText className="size-3" /> : <Paperclip className="size-3" />}
      {attachment.fileName || attachment.caption || 'Открыть'}
    </a>
  )
}

function attachmentIdFromPayload(payload: Json): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const value = payload.attachment_id
  return typeof value === 'string' ? value : null
}

function groupByDay(events: OrderJournalEvent[]) {
  const groups: { label: string; events: OrderJournalEvent[] }[] = []

  for (const event of events) {
    const date = toDate(event.createdAt)
    const label = date ? format(date, 'd MMMM', { locale: ru }) : 'Дата неизвестна'
    const current = groups[groups.length - 1]
    if (current?.label === label) {
      current.events.push(event)
    } else {
      groups.push({ label, events: [event] })
    }
  }

  return groups
}
