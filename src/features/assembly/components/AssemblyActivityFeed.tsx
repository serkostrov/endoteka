import { format } from 'date-fns'
import { ExternalLink, FileText, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { HistoryMonthSections, groupHistoryByMonthAndDay } from '@/components/shared/history-timeline'
import { ImageLightbox, type ImageLightboxItem } from '@/components/shared/ImageLightbox'
import { LoadingState } from '@/components/shared/LoadingState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useCurrentUser, useHasPermission } from '@/features/auth'
import { OrderJournalComposer } from '@/features/orders/components/OrderJournalComposer'
import { CreateTaskDialog } from '@/features/tasks/components/CreateTaskDialog'
import { TaskCompleteControl } from '@/features/tasks/components/TaskCompleteControl'
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet'
import { useTasks } from '@/features/tasks/hooks/use-tasks'
import { taskDueHint, type TaskListItem } from '@/features/tasks/services/tasks-service'
import { Permission } from '@/lib/constants/permissions'
import { TaskJournalEvent, taskPriorityLabels, taskPriorityTone } from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'
import { toDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import type { Json } from '@/types/database'

import {
  useAddAssemblyJournalNote,
  useAssemblyAttachments,
  useAssemblyJournal,
  useDeleteAssemblyAttachment,
  useUploadAssemblyFile,
} from '../hooks/use-assembly'
import {
  assemblyJournalEventTypeLabel,
  type AssemblyAttachment,
  type AssemblyJournalEvent,
} from '../services/assembly-service'

type AssemblyActivityFeedProps = {
  orderId: string
  orderNumber?: string
  hideHeader?: boolean
}

export function AssemblyActivityFeed({
  orderId,
  orderNumber,
  hideHeader = false,
}: AssemblyActivityFeedProps) {
  const user = useCurrentUser()
  const canWrite =
    useHasPermission(Permission.OrdersUpdate) || useHasPermission(Permission.OrdersCreate)
  const canDelete = useHasPermission(Permission.OrdersUpdate)
  const canCreateTask = useHasPermission(Permission.TasksCreate)
  const canReadTasks = useHasPermission(Permission.TasksRead)
  const historyQuery = useAssemblyJournal(orderId)
  const attachmentsQuery = useAssemblyAttachments(orderId)
  const tasksQuery = useTasks(
    {
      search: '',
      assigneeId: 'all',
      status: 'all',
      priority: 'all',
      due: 'all',
      linked: 'all',
      orderId,
      context: 'assembly',
      page: 1,
      pageSize: 100,
    },
    canReadTasks,
  )
  const addNote = useAddAssemblyJournalNote(orderId)
  const upload = useUploadAssemblyFile(orderId)
  const removeAttachment = useDeleteAssemblyAttachment(orderId)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AssemblyAttachment | null>(null)

  const events = useMemo(() => [...(historyQuery.data ?? [])].reverse(), [historyQuery.data])
  const tasks = useMemo(
    () => new Map((tasksQuery.data?.items ?? []).map((task) => [task.id, task])),
    [tasksQuery.data],
  )
  const attachmentsById = useMemo(
    () => new Map((attachmentsQuery.data ?? []).map((item) => [item.id, item])),
    [attachmentsQuery.data],
  )
  const monthGroups = useMemo(
    () => groupHistoryByMonthAndDay(events, (event) => event.createdAt),
    [events],
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

  const showComposer = canWrite || canCreateTask

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px] leading-snug text-foreground/80">
      {hideHeader ? null : (
        <div className="border-b border-border/70 px-3 py-2">
          <p className="text-xs font-medium text-foreground/90">История</p>
          <p className="text-[11px] text-muted-foreground">События, файлы и задачи сборки</p>
        </div>
      )}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {events.length === 0 ? (
          <EmptyState
            className="border-0 bg-transparent py-8"
            title="Событий нет"
            description="Напишите комментарий, прикрепите файл или создайте задачу."
          />
        ) : (
          <HistoryMonthSections
            groups={monthGroups}
            renderDayItems={(dayEvents) => (
              <ol className="relative space-y-3 border-l border-border/70 pl-4">
                {dayEvents.map((event) => {
                  const attachment = attachmentsById.get(
                    payloadString(event.payload, 'attachment_id') ?? '',
                  )
                  const isDeletedAttachment =
                    event.eventType === 'attachment' && payloadBoolean(event.payload, 'deleted')
                  return (
                    <li key={event.id} className="relative">
                      <span className="absolute top-1.5 -left-5 size-1.5 rounded-full bg-muted-foreground/50" />
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {assemblyJournalEventTypeLabel(event.eventType)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {toDate(event.createdAt)
                            ? format(toDate(event.createdAt) as Date, 'HH:mm')
                            : ''}
                        </span>
                      </div>
                      {isTaskJournalEvent(event.eventType) ? null : (
                        <p className={cn(event.eventType === 'comment' && 'whitespace-pre-wrap')}>
                          {event.summary}
                        </p>
                      )}
                      {event.eventType === 'assembly_updated' ? (
                        <AssemblyChangesList payload={event.payload} />
                      ) : null}
                      {event.actorName ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{event.actorName}</p>
                      ) : null}
                      {attachment && !isDeletedAttachment ? (
                        <AttachmentTile
                          item={attachment}
                          canDelete={canDelete}
                          deleting={removeAttachment.isPending}
                          onDelete={() => setDeleteTarget(attachment)}
                        />
                      ) : null}
                      <TaskPreview
                        event={event}
                        task={tasks.get(payloadString(event.payload, 'task_id') ?? '')}
                        currentUserId={user?.id}
                        onOpen={(taskId) => setOpenTaskId(taskId)}
                      />
                    </li>
                  )
                })}
              </ol>
            )}
          />
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
          presetContext="assembly"
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
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить файл"
        description={`«${deleteTarget?.fileName || deleteTarget?.caption || 'Вложение'}» будет удалён.`}
        confirmLabel="Удалить"
        isPending={removeAttachment.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        onConfirm={() => {
          if (!deleteTarget) {
            return
          }
          void removeAttachment
            .mutateAsync({ id: deleteTarget.id, filePath: deleteTarget.filePath })
            .then(() => {
              setDeleteTarget(null)
              toast.success('Файл удалён')
            })
            .catch((error) => toast.error(getErrorMessage(error)))
        }}
      />
    </div>
  )
}

function AttachmentTile({
  item,
  canDelete,
  deleting,
  onDelete,
}: {
  item: AssemblyAttachment
  canDelete: boolean
  deleting: boolean
  onDelete: () => void
}) {
  const [viewerOpen, setViewerOpen] = useState(false)
  const href = item.kind === 'url' ? item.url : item.signedUrl
  const isPhoto = item.kind === 'photo' && Boolean(item.signedUrl)
  const lightboxItems: ImageLightboxItem[] = isPhoto
    ? [
        {
          id: item.id,
          src: item.signedUrl as string,
          alt: item.fileName || item.caption || 'Фото',
          title: item.fileName || item.caption || 'Фото',
        },
      ]
    : []

  return (
    <>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-left text-xs hover:bg-muted/50"
          onClick={() => {
            if (isPhoto) {
              setViewerOpen(true)
              return
            }
            if (href) {
              window.open(href, '_blank', 'noopener,noreferrer')
            }
          }}
        >
          {isPhoto ? (
            <img
              src={item.signedUrl as string}
              alt=""
              className="size-8 rounded object-cover"
              draggable={false}
            />
          ) : item.kind === 'pdf' ? (
            <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PDF</span>
          ) : (
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{item.fileName || item.caption || item.url || 'Файл'}</span>
          {item.kind === 'url' ? <ExternalLink className="size-3 shrink-0 text-muted-foreground" /> : null}
        </button>
        {canDelete ? (
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
            disabled={deleting}
            aria-label="Удалить файл"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
      {isPhoto ? (
        <ImageLightbox
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          items={lightboxItems}
          index={0}
          onIndexChange={() => undefined}
        />
      ) : null}
    </>
  )
}

function TaskPreview({
  event,
  task,
  currentUserId,
  onOpen,
}: {
  event: AssemblyJournalEvent
  task?: TaskListItem
  currentUserId?: string
  onOpen: (taskId: string) => void
}) {
  if (!isTaskJournalEvent(event.eventType)) {
    return null
  }
  const taskId = payloadString(event.payload, 'task_id')
  if (!taskId || !task) {
    return <p className="mt-1 text-sm">{event.summary}</p>
  }

  const canOpen = currentUserId && task.createdBy === currentUserId
  const due = taskDueHint(task.dueDate, task.completed)

  return (
    <div className="mt-1.5 rounded-lg border bg-background/80 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {canOpen ? (
            <button
              type="button"
              className="truncate text-left text-sm font-medium text-primary hover:underline"
              onClick={() => onOpen(task.id)}
            >
              {task.title}
            </button>
          ) : (
            <p className="truncate text-sm font-medium">{task.title}</p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {task.assigneeName || 'Без исполнителя'}
            {due ? ` · ${due}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge tone={taskPriorityTone(task.priority)}>{taskPriorityLabels[task.priority]}</StatusBadge>
          <TaskCompleteControl task={task} />
        </div>
      </div>
    </div>
  )
}

function AssemblyChangesList({ payload }: { payload: Json }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const raw = payload.changes
  if (!Array.isArray(raw) || raw.length === 0) {
    return null
  }

  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
      {raw.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null
        }
        const action = typeof entry.action === 'string' ? entry.action : ''
        const name = typeof entry.name === 'string' ? entry.name : 'Позиция'
        if (action === 'added') {
          return (
            <li key={`change-${index}`}>
              Добавлена: {name}
              {typeof entry.qty_required === 'number' || typeof entry.qty_collected === 'number'
                ? ` (${String(entry.qty_collected ?? 0)} / ${String(entry.qty_required ?? 0)})`
                : ''}
            </li>
          )
        }
        if (action === 'removed') {
          return <li key={`change-${index}`}>Удалена: {name}</li>
        }
        if (action === 'updated') {
          const from = entry.from && typeof entry.from === 'object' && !Array.isArray(entry.from) ? entry.from : null
          const to = entry.to && typeof entry.to === 'object' && !Array.isArray(entry.to) ? entry.to : null
          const fromCol = from && typeof from.qty_collected === 'number' ? from.qty_collected : null
          const toCol = to && typeof to.qty_collected === 'number' ? to.qty_collected : null
          const fromReq = from && typeof from.qty_required === 'number' ? from.qty_required : null
          const toReq = to && typeof to.qty_required === 'number' ? to.qty_required : null
          const qtyHint =
            fromCol !== null && toCol !== null && fromReq !== null && toReq !== null
              ? ` (${fromCol}/${fromReq} → ${toCol}/${toReq})`
              : ''
          return (
            <li key={`change-${index}`}>
              Обновлена: {name}
              {qtyHint}
            </li>
          )
        }
        return (
          <li key={`change-${index}`}>
            {name}
          </li>
        )
      })}
    </ul>
  )
}

function payloadString(payload: Json, key: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

function payloadBoolean(payload: Json, key: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false
  }
  return payload[key] === true
}

function isTaskJournalEvent(eventType: string) {
  return (
    eventType === TaskJournalEvent.Created ||
    eventType === TaskJournalEvent.Completed ||
    eventType === TaskJournalEvent.Deleted
  )
}
