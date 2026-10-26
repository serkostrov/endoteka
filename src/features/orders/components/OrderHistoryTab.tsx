import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { DiagnosticJournalEvent } from '@/features/diagnostics/constants'
import { useOrderJournal } from '@/features/diagnostics/hooks/use-diagnostics'
import {
  formatJournalEventBody,
  formatJournalValue,
} from '@/features/diagnostics/services/diagnostics-service'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'
import type { Json } from '@/types/database'

import { orderJournalEventTypeLabel } from '../lib/journal-labels'
import { JournalStatusChangeBody } from './OrderBadges'

type OrderHistoryTabProps = {
  orderId: string
}

export function OrderHistoryTab({ orderId }: OrderHistoryTabProps) {
  const historyQuery = useOrderJournal(orderId)

  if (historyQuery.isLoading) {
    return <LoadingState label="Загрузка журнала" />
  }

  if (historyQuery.error) {
    return <ErrorState description={getErrorMessage(historyQuery.error)} />
  }

  const events = historyQuery.data ?? []

  return (
    <SectionCard
      title="Журнал заказа"
      description="Статусы, диагностика, комментарии, задачи и файлы. Системные записи изменить нельзя."
    >
      {events.length === 0 ? (
        <EmptyState title="Записей нет" description="Смены статуса, диагностика, задачи и склад появятся здесь." />
      ) : (
        <ol className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="border-b pb-3 last:border-b-0 last:pb-0">
              {event.eventType === DiagnosticJournalEvent.StatusChanged ? (
                <JournalStatusChangeBody event={event} />
              ) : (
                <p className="text-sm font-medium tabular-nums">{formatJournalEventBody(event)}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {orderJournalEventTypeLabel(event.eventType, event.summary)}
                {' · '}
                {formatDateTime(event.createdAt)}
                {actorLine(event.actorName, event.payload)}
              </p>
              {event.changes.length > 0 && event.eventType !== 'total_changed' ? (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {event.changes.map((change) => (
                    <li key={`${event.id}-${change.field}`} className="tabular-nums">
                      {change.label}:{' '}
                      {formatJournalValue(change.from, { field: change.field, label: change.label })} →{' '}
                      {formatJournalValue(change.to, { field: change.field, label: change.label })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  )
}

function actorLine(actorName: string, payload: Json) {
  const fromPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.actor_name === 'string'
      ? payload.actor_name
      : ''
  const name = actorName || fromPayload
  return name ? ` · ${name}` : ''
}
