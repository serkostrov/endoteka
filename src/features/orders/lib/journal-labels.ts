import { DiagnosticJournalEvent } from '@/features/diagnostics/constants'
import { OrderJournalEventType } from '@/lib/constants/orders'
import { TaskJournalEvent } from '@/lib/constants/tasks'

export function orderJournalEventTypeLabel(eventType: string) {
  if (eventType === DiagnosticJournalEvent.Created || eventType === DiagnosticJournalEvent.Updated) {
    return 'Диагностика'
  }
  if (eventType === DiagnosticJournalEvent.StatusChanged) {
    return 'Статус'
  }
  if (eventType === TaskJournalEvent.Created || eventType === TaskJournalEvent.Completed || eventType === TaskJournalEvent.Deleted) {
    return 'Задача'
  }
  if (eventType === 'parts_consumed' || eventType === 'parts_returned') {
    return 'Склад'
  }
  if (eventType === 'service_added' || eventType === 'service_removed') {
    return 'Услуга'
  }
  if (eventType === 'responsible_assigned') {
    return 'Назначение'
  }
  if (eventType === 'customer_changed') {
    return 'Клиент'
  }
  if (eventType === 'device_changed') {
    return 'Прибор'
  }
  if (eventType === OrderJournalEventType.Comment) {
    return 'Комментарий'
  }
  if (eventType === OrderJournalEventType.Attachment) {
    return 'Файл'
  }
  return 'Событие'
}
