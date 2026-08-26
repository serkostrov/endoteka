import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { useOrderJournal } from '@/features/diagnostics/hooks/use-diagnostics'
import { formatJournalValue } from '@/features/diagnostics/services/diagnostics-service'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { orderJournalEventTypeLabel } from '../lib/journal-labels'

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
              <p className="text-sm font-medium">{event.summary}</p>
              <p className="text-xs text-muted-foreground">
                {orderJournalEventTypeLabel(event.eventType)}
                {' · '}
                {formatDateTime(event.createdAt)}
                {event.actorName ? ` · ${event.actorName}` : ''}
              </p>
              {event.changes.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {event.changes.map((change) => (
                    <li key={`${event.id}-${change.field}`}>
                      {change.label}: {formatJournalValue(change.from)} → {formatJournalValue(change.to)}
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
