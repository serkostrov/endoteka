import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { useMarkNotificationRead, useMarkNotificationsRead, useNotifications, useUnreadNotificationCount } from '../hooks/use-notifications'
import { TelegramLinkCard } from './TelegramLinkCard'

type NotificationsButtonProps = {
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function NotificationsButton({
  side = 'bottom',
  align = 'end',
  className,
}: NotificationsButtonProps) {
  const notificationsQuery = useNotifications(true)
  const unreadQuery = useUnreadNotificationCount(true)
  const markAll = useMarkNotificationsRead()
  const markOne = useMarkNotificationRead()
  const items = notificationsQuery.data ?? []
  const unread = unreadQuery.data ?? 0

  function targetPath(entityType: string | null, entityId: string | null) {
    if (entityType === 'order' && entityId) {
      return routes.order.replace(':id', entityId)
    }
    if (entityType === 'task' && entityId) {
      return routes.task.replace(':id', entityId)
    }
    return null
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Уведомления"
          className={cn('relative', className)}
        >
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-sm font-medium">Уведомления</p>
          {unread > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={markAll.isPending}
              onClick={() => void markAll.mutateAsync()}
            >
              Прочитать все
            </Button>
          ) : null}
        </div>
        {notificationsQuery.error ? (
          <p className="px-3 py-6 text-sm text-destructive">{getErrorMessage(notificationsQuery.error)}</p>
        ) : items.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">Нет уведомлений</div>
        ) : (
          <ul className="max-h-96 overflow-auto">
            {items.map((item) => {
              const to = targetPath(item.entityType, item.entityId)
              const content = (
                <>
                  <p className={cn('text-sm', item.isRead ? 'font-normal' : 'font-medium')}>{item.title}</p>
                  {item.body ? <p className="text-xs text-muted-foreground">{item.body}</p> : null}
                  <p className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                </>
              )

              return (
                <li key={item.id} className="border-b last:border-b-0">
                  {to ? (
                    <Link
                      to={to}
                      className="block px-3 py-2 hover:bg-accent"
                      onClick={() => {
                        if (!item.isRead) {
                          void markOne.mutateAsync(item.id)
                        }
                      }}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left hover:bg-accent"
                      onClick={() => {
                        if (!item.isRead) {
                          void markOne.mutateAsync(item.id)
                        }
                      }}
                    >
                      {content}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <div className="border-t px-3 py-2">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Telegram</p>
          <TelegramLinkCard compact />
        </div>
      </PopoverContent>
    </Popover>
  )
}
