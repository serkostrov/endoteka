import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { useCreateTelegramLinkCode, useMyTelegramLink, useUnlinkTelegram } from '../hooks/use-notifications'

type TelegramLinkCardProps = {
  compact?: boolean
}

export function TelegramLinkCard({ compact = false }: TelegramLinkCardProps) {
  const linkQuery = useMyTelegramLink(true)
  const createCode = useCreateTelegramLinkCode()
  const unlink = useUnlinkTelegram()
  const link = linkQuery.data
  const bot = link?.botUsername ? `@${link.botUsername}` : ''

  async function handleCode() {
    try {
      await createCode.mutateAsync()
      toast.success('Код создан')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleUnlink() {
    try {
      await unlink.mutateAsync()
      toast.success('Telegram отвязан')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  if (linkQuery.error) {
    return <p className="text-sm text-destructive">{getErrorMessage(linkQuery.error)}</p>
  }

  return (
    <div className="space-y-2">
      {compact ? null : (
        <p className="text-sm text-muted-foreground">
          Токен бота хранится в секретах сервера и в браузер не попадает. Привязка идёт по одноразовому коду.
        </p>
      )}
      {link?.linked ? (
        <p className="text-sm">
          Привязан{link.telegramUsername ? ` как @${link.telegramUsername}` : ''}.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Telegram ещё не привязан.</p>
      )}
      {link?.pendingCode ? (
        <div className="rounded-md border px-3 py-2 text-sm">
          <p>
            Напишите боту {bot || 'из настроек'} команду:
          </p>
          <p className="mt-1 font-mono text-base">/start {link.pendingCode}</p>
          {link.pendingExpiresAt ? (
            <p className="mt-1 text-xs text-muted-foreground">До {formatDateTime(link.pendingExpiresAt)}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={createCode.isPending} onClick={() => void handleCode()}>
          {createCode.isPending ? 'Код…' : link?.linked ? 'Новый код' : 'Получить код'}
        </Button>
        {link?.linked ? (
          <Button type="button" size="sm" variant="ghost" disabled={unlink.isPending} onClick={() => void handleUnlink()}>
            Отвязать
          </Button>
        ) : null}
      </div>
    </div>
  )
}
