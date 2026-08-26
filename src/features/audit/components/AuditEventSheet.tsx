import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  auditActionLabel,
  auditEntityTypeLabel,
  auditMetadataKeyLabel,
} from '@/lib/constants/audit'
import { formatDateTime } from '@/lib/utils/date'
import type { Json } from '@/types/database'

import { auditEntityHref, type AuditEvent } from '../services/audit-service'

type AuditEventSheetProps = {
  event: AuditEvent | null
  onOpenChange: (open: boolean) => void
}

export function AuditEventSheet({ event, onOpenChange }: AuditEventSheetProps) {
  const entityHref = event ? auditEntityHref(event.entityType, event.entityId) : null
  const metadataEntries = event ? Object.entries(event.metadata) : []

  return (
    <Sheet open={Boolean(event)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{event ? auditActionLabel(event.action) : 'Событие'}</SheetTitle>
          <SheetDescription>
            Запись журнала только для просмотра. Изменить или удалить её нельзя.
          </SheetDescription>
        </SheetHeader>

        {event ? (
          <dl className="grid gap-4 px-4 pb-4 text-sm">
            <Detail label="Время" value={formatDateTime(event.createdAt)} />
            <Detail
              label="Пользователь"
              value={
                event.actorEmail ? `${event.actorName} (${event.actorEmail})` : event.actorName
              }
            />
            <Detail label="Действие" value={auditActionLabel(event.action)} hint={event.action} />
            <Detail label="Объект" value={auditEntityTypeLabel(event.entityType)} hint={event.entityType} />
            <div className="grid gap-1">
              <dt className="text-muted-foreground">Идентификатор</dt>
              <dd className="break-all">
                {entityHref && event.entityId ? (
                  <Link className="text-primary underline-offset-4 hover:underline" to={entityHref}>
                    {event.entityId}
                  </Link>
                ) : (
                  (event.entityId ?? '—')
                )}
              </dd>
            </div>
            <Detail label="IP-адрес" value={event.ipAddress ?? '—'} />
            <Detail label="User-Agent" value={event.userAgent ?? '—'} />
            <div className="grid gap-2">
              <dt className="text-muted-foreground">Данные события</dt>
              <dd>
                {metadataEntries.length === 0 ? (
                  <p>—</p>
                ) : (
                  <ul className="space-y-2">
                    {metadataEntries.map(([key, value]) => (
                      <li key={key}>
                        <p className="font-medium">{auditMetadataKeyLabel(key)}</p>
                        <pre className="bg-muted mt-1 overflow-x-auto rounded-md p-2 text-xs whitespace-pre-wrap">
                          {formatMetadataValue(value)}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        ) : null}

        <SheetFooter className="px-4 pb-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function Detail({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {value}
        {hint && hint !== value ? (
          <span className="text-muted-foreground mt-0.5 block text-xs">{hint}</span>
        ) : null}
      </dd>
    </div>
  )
}

function formatMetadataValue(value: Json | undefined): string {
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value, null, 2)
}
