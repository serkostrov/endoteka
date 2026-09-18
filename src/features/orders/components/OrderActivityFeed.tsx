import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Calendar, ExternalLink, FileText, ListTodo, Trash2, User } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ImageHoverPreview, ImageLightbox, type ImageLightboxItem } from '@/components/shared/ImageLightbox'
import { LoadingState } from '@/components/shared/LoadingState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useHasPermission, useCurrentUser } from '@/features/auth'
import { useAddOrderJournalNote, useOrderJournal } from '@/features/diagnostics/hooks/use-diagnostics'
import { formatJournalValue, type OrderJournalEvent } from '@/features/diagnostics/services/diagnostics-service'
import { CreateTaskDialog } from '@/features/tasks/components/CreateTaskDialog'
import { TaskCompleteControl } from '@/features/tasks/components/TaskCompleteControl'
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet'
import { useTasks } from '@/features/tasks/hooks/use-tasks'
import { taskDueHint, type TaskListItem } from '@/features/tasks/services/tasks-service'
import { OrderJournalEventType } from '@/lib/constants/orders'
import { Permission } from '@/lib/constants/permissions'
import { TaskJournalEvent, taskPriorityLabels, taskPriorityTone } from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'
import { toDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import type { Json } from '@/types/database'

import { useDeleteOrderAttachment, useOrderAttachments, useUploadOrderFile } from '../hooks/use-orders'
import { orderJournalEventTypeLabel } from '../lib/journal-labels'
import type { OrderAttachment } from '../services/orders-service'
import { OrderJournalComposer } from './OrderJournalComposer'

/** Окно склейки подряд загруженных файлов в одну запись ленты. */
const ATTACHMENT_BATCH_MS = 20_000
const ATTACHMENT_PREVIEW_LIMIT = 3

type OrderActivityFeedProps = {
  orderId: string
  orderNumber?: string
}

type FeedEntry =
  | { kind: 'single'; event: OrderJournalEvent }
  | { kind: 'attachments'; events: OrderJournalEvent[] }

export function OrderActivityFeed({ orderId, orderNumber }: OrderActivityFeedProps) {
  const user = useCurrentUser()
  const canWrite =
    useHasPermission(Permission.OrdersUpdate) || useHasPermission(Permission.OrdersCreate)
  const canDelete = useHasPermission(Permission.OrdersUpdate)
  const canCreateTask = useHasPermission(Permission.TasksCreate)
  const canReadTasks = useHasPermission(Permission.TasksRead)
  const historyQuery = useOrderJournal(orderId)
  const attachmentsQuery = useOrderAttachments(orderId)
  const tasksQuery = useTasks(
    {
      search: '',
      assigneeId: 'all',
      status: 'all',
      priority: 'all',
      due: 'all',
      linked: 'all',
      orderId,
      page: 1,
      pageSize: 100,
    },
    canReadTasks,
  )
  const addNote = useAddOrderJournalNote(orderId)
  const upload = useUploadOrderFile(orderId)
  const removeAttachment = useDeleteOrderAttachment(orderId)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const events = useMemo(() => [...(historyQuery.data ?? [])].reverse(), [historyQuery.data])
  const tasks = useMemo(
    () => new Map((tasksQuery.data?.items ?? []).map((task) => [task.id, task])),
    [tasksQuery.data],
  )
  const attachmentsById = useMemo(
    () => new Map((attachmentsQuery.data ?? []).map((item) => [item.id, item])),
    [attachmentsQuery.data],
  )
  const feedEntries = useMemo(() => collapseAttachmentBatches(events), [events])
  const dayGroups = useMemo(() => groupFeedByDay(feedEntries), [feedEntries])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [feedEntries])

  async function handleDeleteAttachment(item: OrderAttachment) {
    await removeAttachment.mutateAsync({ id: item.id, filePath: item.filePath ?? null })
    toast.success('Файл удалён')
  }

  if (historyQuery.isLoading) {
    return <LoadingState label="Загрузка событий" className="min-h-32" />
  }

  if (historyQuery.error) {
    return <ErrorState description={getErrorMessage(historyQuery.error)} />
  }

  const showComposer = canWrite || canCreateTask

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <p className="text-sm font-medium">История</p>
        <p className="text-xs text-muted-foreground">События, фото, ссылки и задачи заказа</p>
      </div>
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {events.length === 0 ? (
          <EmptyState
            className="border-0 bg-transparent py-8"
            title="Событий нет"
            description="Напишите событие, прикрепите фото или создайте задачу."
          />
        ) : (
          <div className="space-y-5">
            {dayGroups.map((group) => (
              <section key={group.label}>
                <h3 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </h3>
                <ol className="relative space-y-4 border-l border-border pl-4">
                  {group.entries.map((entry) => {
                    if (entry.kind === 'attachments') {
                      const head = entry.events[0]
                      const batchAttachments = entry.events
                        .map((event) =>
                          attachmentsById.get(payloadString(event.payload, 'attachment_id') ?? ''),
                        )
                        .filter((item): item is OrderAttachment => Boolean(item))
                      if (batchAttachments.length === 0) {
                        return null
                      }
                      return (
                        <li key={entry.events.map((event) => event.id).join('-')} className="relative">
                          <span className="absolute top-1.5 -left-5 size-2 rounded-full bg-primary" />
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-info/12 px-1.5 py-0.5 text-xs font-medium text-info">
                              {orderJournalEventTypeLabel(OrderJournalEventType.Attachment)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {toDate(head.createdAt)
                                ? format(toDate(head.createdAt) as Date, 'HH:mm')
                                : ''}
                            </span>
                          </div>
                          {head.actorName ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">{head.actorName}</p>
                          ) : null}
                          <JournalAttachmentBatch
                            attachments={batchAttachments}
                            canDelete={canDelete}
                            deleting={removeAttachment.isPending}
                            onDelete={handleDeleteAttachment}
                          />
                        </li>
                      )
                    }

                    const event = entry.event
                    return (
                      <li key={event.id} className="relative">
                        <span className="absolute top-1.5 -left-5 size-2 rounded-full bg-primary" />
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-info/12 px-1.5 py-0.5 text-xs font-medium text-info">
                            {orderJournalEventTypeLabel(event.eventType)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {toDate(event.createdAt)
                              ? format(toDate(event.createdAt) as Date, 'HH:mm')
                              : ''}
                          </span>
                        </div>
                        {isTaskJournalEvent(event.eventType) ? null : (
                          <p
                            className={
                              event.eventType === OrderJournalEventType.Comment
                                ? 'text-sm whitespace-pre-wrap'
                                : 'text-sm'
                            }
                          >
                            {event.summary}
                          </p>
                        )}
                        {event.actorName ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">{event.actorName}</p>
                        ) : null}
                        {event.changes.length > 0 ? (
                          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            {event.changes.map((change) => (
                              <li key={`${event.id}-${change.field}`}>
                                {change.label}: {formatJournalValue(change.from)} →{' '}
                                {formatJournalValue(change.to)}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <JournalTaskPreview
                          event={event}
                          task={tasks.get(payloadString(event.payload, 'task_id') ?? '')}
                          currentUserId={user?.id}
                          onOpen={(taskId) => setOpenTaskId(taskId)}
                        />
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
      {showComposer ? (
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
          onCreateTask={canCreateTask ? () => setCreateTaskOpen(true) : undefined}
        />
      ) : null}
      {canCreateTask ? (
        <CreateTaskDialog
          open={createTaskOpen}
          onOpenChange={setCreateTaskOpen}
          presetOrderId={orderId}
          presetOrderNumber={orderNumber}
        />
      ) : null}
      <TaskDetailSheet
        taskId={openTaskId}
        open={Boolean(openTaskId)}
        onOpenChange={(open) => {
          if (!open) {
            setOpenTaskId(null)
          }
        }}
      />
    </div>
  )
}

function JournalAttachmentBatch({
  attachments,
  canDelete,
  deleting,
  onDelete,
}: {
  attachments: OrderAttachment[]
  canDelete: boolean
  deleting: boolean
  onDelete: (item: OrderAttachment) => Promise<void>
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OrderAttachment | null>(null)

  if (attachments.length === 0) {
    return null
  }

  const photos = attachments.filter((item) => item.kind === 'photo' && item.signedUrl)
  const lightboxItems: ImageLightboxItem[] = photos.map((item) => ({
    id: item.id,
    src: item.signedUrl as string,
    alt: item.fileName || item.caption || 'Фото',
    title: item.fileName || item.caption || 'Фото',
  }))

  const visible = attachments.slice(0, ATTACHMENT_PREVIEW_LIMIT)
  const overflow = Math.max(0, attachments.length - ATTACHMENT_PREVIEW_LIMIT)

  function openAttachment(item: OrderAttachment) {
    if (item.kind === 'photo' && item.signedUrl) {
      const index = photos.findIndex((entry) => entry.id === item.id)
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

  async function handleLightboxDelete(item: ImageLightboxItem) {
    if (!item.id) {
      return
    }
    const attachment = attachments.find((entry) => entry.id === item.id)
    if (!attachment) {
      return
    }
    await onDelete(attachment)
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visible.map((item, index) => {
          const showOverflow = overflow > 0 && index === visible.length - 1
          return (
            <AttachmentFeedTile
              key={item.id}
              item={item}
              overflow={showOverflow ? overflow : 0}
              canDelete={canDelete && !showOverflow}
              deleting={deleting}
              onOpen={() => openAttachment(item)}
              onDelete={() => setDeleteTarget(item)}
            />
          )
        })}
      </div>
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
        onDelete={canDelete ? handleLightboxDelete : undefined}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить файл"
        description={`«${deleteTarget?.fileName || deleteTarget?.caption || 'Вложение'}» будет удалён. Это действие необратимо.`}
        confirmLabel="Удалить"
        isPending={deleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        onConfirm={async () => {
          if (!deleteTarget) {
            return
          }
          try {
            await onDelete(deleteTarget)
            setDeleteTarget(null)
          } catch (error) {
            toast.error(getErrorMessage(error))
          }
        }}
      />
    </>
  )
}

function AttachmentFeedTile({
  item,
  overflow,
  canDelete,
  deleting,
  onOpen,
  onDelete,
}: {
  item: OrderAttachment
  overflow: number
  canDelete: boolean
  deleting: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const label = item.fileName || item.caption || item.url || 'Вложение'
  const thumb = <AttachmentFeedThumb item={item} />

  return (
    <div className="group relative size-16 shrink-0">
      <button
        type="button"
        className="size-full overflow-hidden rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={overflow > 0 ? `${label}, ещё ${overflow}` : `Открыть «${label}»`}
        onClick={onOpen}
      >
        {item.kind === 'photo' && item.signedUrl && overflow === 0 ? (
          <ImageHoverPreview src={item.signedUrl} alt={label} className="size-full">
            <span className="block size-full">{thumb}</span>
          </ImageHoverPreview>
        ) : (
          thumb
        )}
        {overflow > 0 ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
            +{overflow}
          </span>
        ) : null}
      </button>
      {canDelete ? (
        <button
          type="button"
          className="absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded-md bg-background/90 text-destructive opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Удалить «${label}»`}
          disabled={deleting}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function AttachmentFeedThumb({ item }: { item: OrderAttachment }) {
  if (item.kind === 'photo' && item.signedUrl) {
    return <img src={item.signedUrl} alt="" draggable={false} className="size-full object-cover" />
  }

  if (item.kind === 'pdf') {
    return (
      <div className="flex size-full items-center justify-center bg-red-600 text-[11px] font-bold text-white">
        PDF
      </div>
    )
  }

  return (
    <div className="flex size-full items-center justify-center bg-muted text-muted-foreground">
      {item.kind === 'url' ? <ExternalLink className="size-5" /> : <FileText className="size-5" />}
    </div>
  )
}

function JournalTaskPreview({
  event,
  task,
  currentUserId,
  onOpen,
}: {
  event: OrderJournalEvent
  task: TaskListItem | undefined
  currentUserId: string | undefined
  onOpen: (taskId: string) => void
}) {
  if (!isTaskJournalEvent(event.eventType)) {
    return null
  }

  const deleted = event.eventType === TaskJournalEvent.Deleted
  const canOpenSheet = Boolean(task && currentUserId && task.createdBy === currentUserId)

  if (task && !deleted) {
    const due = taskDueHint(task.dueDate, task.completed)
    return (
      <div
        role={canOpenSheet ? 'button' : undefined}
        tabIndex={canOpenSheet ? 0 : undefined}
        className={cn(
          'mt-2 w-full rounded-md border bg-background px-2.5 py-2 text-left',
          canOpenSheet && 'cursor-pointer hover:bg-accent/40',
          task.completed && 'opacity-80',
        )}
        onClick={canOpenSheet ? () => onOpen(task.id) : undefined}
        onKeyDown={
          canOpenSheet
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpen(task.id)
                }
              }
            : undefined
        }
      >
        <div className="flex items-start gap-2">
          <TaskCompleteControl task={task} />
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm font-medium', task.completed && 'text-muted-foreground line-through')}>
              {task.title}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <User className="size-3" />
                {task.assigneeName || 'не назначен'}
              </span>
              {due ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1',
                    due.tone === 'danger' && 'text-destructive',
                    due.tone === 'warning' && 'text-warning',
                  )}
                >
                  <Calendar className="size-3" />
                  {due.label}
                </span>
              ) : null}
              <StatusBadge tone={taskPriorityTone(task.priority)}>{taskPriorityLabels[task.priority]}</StatusBadge>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-2">
      <ListTodo className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-sm">{event.summary}</p>
      </div>
    </div>
  )
}

function isTaskJournalEvent(eventType: string) {
  return (
    eventType === TaskJournalEvent.Created ||
    eventType === TaskJournalEvent.Completed ||
    eventType === TaskJournalEvent.Deleted
  )
}

function payloadString(payload: Json, key: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

function payloadDeleted(payload: Json): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false
  }
  return payload.deleted === true
}

function isAttachmentUploadEvent(event: OrderJournalEvent) {
  return event.eventType === OrderJournalEventType.Attachment && !payloadDeleted(event.payload)
}

function sameActor(a: OrderJournalEvent, b: OrderJournalEvent) {
  if (a.actorId && b.actorId) {
    return a.actorId === b.actorId
  }
  return a.actorName === b.actorName
}

function withinBatchWindow(a: OrderJournalEvent, b: OrderJournalEvent) {
  const left = toDate(a.createdAt)?.getTime()
  const right = toDate(b.createdAt)?.getTime()
  if (left == null || right == null) {
    return false
  }
  return Math.abs(right - left) <= ATTACHMENT_BATCH_MS
}

function collapseAttachmentBatches(events: OrderJournalEvent[]): FeedEntry[] {
  const entries: FeedEntry[] = []

  for (const event of events) {
    if (!isAttachmentUploadEvent(event)) {
      entries.push({ kind: 'single', event })
      continue
    }

    const last = entries[entries.length - 1]
    if (last?.kind === 'attachments') {
      const head = last.events[0]
      const prev = last.events[last.events.length - 1]
      if (sameActor(head, event) && withinBatchWindow(prev, event)) {
        last.events.push(event)
        continue
      }
    }

    entries.push({ kind: 'attachments', events: [event] })
  }

  return entries
}

function groupFeedByDay(entries: FeedEntry[]) {
  const groups: { label: string; entries: FeedEntry[] }[] = []

  for (const entry of entries) {
    const createdAt = entry.kind === 'attachments' ? entry.events[0].createdAt : entry.event.createdAt
    const date = toDate(createdAt)
    const label = date ? format(date, 'd MMMM', { locale: ru }) : 'Дата неизвестна'
    const current = groups[groups.length - 1]
    if (current?.label === label) {
      current.entries.push(entry)
    } else {
      groups.push({ label, entries: [entry] })
    }
  }

  return groups
}
