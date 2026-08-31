import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Calendar, FileText, Link2, ListTodo, User } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { OpenableImage } from '@/components/shared/ImageLightbox'
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

import { useOrderAttachments, useUploadOrderFile } from '../hooks/use-orders'
import { orderJournalEventTypeLabel } from '../lib/journal-labels'
import type { OrderAttachment } from '../services/orders-service'
import { OrderJournalComposer } from './OrderJournalComposer'

type OrderActivityFeedProps = {
  orderId: string
  orderNumber?: string
}

export function OrderActivityFeed({ orderId, orderNumber }: OrderActivityFeedProps) {
  const user = useCurrentUser()
  const canWrite =
    useHasPermission(Permission.OrdersUpdate) || useHasPermission(Permission.OrdersCreate)
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
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const events = useMemo(() => [...(historyQuery.data ?? [])].reverse(), [historyQuery.data])
  const tasks = useMemo(
    () => new Map((tasksQuery.data?.items ?? []).map((task) => [task.id, task])),
    [tasksQuery.data],
  )

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

  const groups = groupEventsByDay(events)
  const attachments = new Map((attachmentsQuery.data ?? []).map((item) => [item.id, item]))
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
                              {change.label}: {formatJournalValue(change.from)} → {formatJournalValue(change.to)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <JournalAttachmentPreview
                        event={event}
                        attachment={attachments.get(payloadString(event.payload, 'attachment_id') ?? '')}
                      />
                      <JournalTaskPreview
                        event={event}
                        task={tasks.get(payloadString(event.payload, 'task_id') ?? '')}
                        currentUserId={user?.id}
                        onOpen={(taskId) => setOpenTaskId(taskId)}
                      />
                    </li>
                  ))}
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
    const label = attachment.fileName || attachment.caption || 'Фото'
    return (
      <div className="mt-2 w-fit">
        <OpenableImage src={attachment.signedUrl} alt={label} title={label} className="size-16" />
      </div>
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
      {attachment.kind === 'pdf' ? <FileText className="size-3" /> : <Link2 className="size-3" />}
      {attachment.fileName || attachment.caption || attachment.url || 'Открыть'}
    </a>
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

function groupEventsByDay(events: OrderJournalEvent[]) {
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
