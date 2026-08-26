import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { NotificationTarget, notificationEventLabels, notificationTargetLabels } from '@/lib/constants/notifications'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { TelegramLinkCard } from './TelegramLinkCard'
import {
  useDeleteNotificationRule,
  useNotificationAdmin,
  useSaveNotificationChannels,
  useUpsertNotificationRule,
} from '../hooks/use-notifications'
import type { NotificationChannelSettings, NotificationRule } from '../services/notifications-service'

export function NotificationSettingsScreen() {
  const canUpdate = useHasPermission(Permission.SettingsUpdate)
  const adminQuery = useNotificationAdmin(true)
  const saveChannels = useSaveNotificationChannels()
  const upsertRule = useUpsertNotificationRule()
  const deleteRule = useDeleteNotificationRule()
  const admin = adminQuery.data
  const [channels, setChannels] = useState<NotificationChannelSettings | null>(null)
  const channelValues = channels ??
    admin?.channels ?? {
      emailEnabled: false,
      fromName: 'Эндотека',
      fromEmail: '',
      telegramEnabled: false,
      telegramBotUsername: '',
    }

  async function handleSaveChannels() {
    try {
      await saveChannels.mutateAsync(channelValues)
      setChannels(null)
      toast.success('Каналы сохранены')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleToggle(rule: NotificationRule, patch: Partial<NotificationRule>) {
    try {
      await upsertRule.mutateAsync({
        id: rule.id,
        eventCode: rule.eventCode,
        targetKind: rule.targetKind,
        roleId: rule.roleId,
        channelInApp: patch.channelInApp ?? rule.channelInApp,
        channelEmail: patch.channelEmail ?? rule.channelEmail,
        channelTelegram: patch.channelTelegram ?? rule.channelTelegram,
        isActive: patch.isActive ?? rule.isActive,
      })
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteRule.mutateAsync(id)
      toast.success('Правило удалено')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  if (adminQuery.isLoading) {
    return <LoadingState label="Загрузка настроек уведомлений" />
  }

  if (adminQuery.error) {
    return <ErrorState description={getErrorMessage(adminQuery.error)} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Уведомления"
        description="Событие выбирает получателей и каналы. Письма и Telegram уходят отдельно и не откатывают заказ."
      />

      <SectionCard title="Ваш Telegram" description="Привязка чата к учётной записи сотрудника.">
        <TelegramLinkCard />
      </SectionCard>

      <SectionCard
            title="Каналы"
            description="Пароль SMTP и токен бота задаются секретами функций, не полями этой формы."
            actions={
              canUpdate ? (
                <Button type="button" size="sm" disabled={saveChannels.isPending} onClick={() => void handleSaveChannels()}>
                  {saveChannels.isPending ? 'Сохранение…' : 'Сохранить'}
                </Button>
              ) : null
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={channelValues.emailEnabled}
                  disabled={!canUpdate}
                  onCheckedChange={(checked) =>
                    setChannels({ ...channelValues, emailEnabled: checked === true })
                  }
                />
                Email
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={channelValues.telegramEnabled}
                  disabled={!canUpdate}
                  onCheckedChange={(checked) =>
                    setChannels({ ...channelValues, telegramEnabled: checked === true })
                  }
                />
                Telegram
              </label>
              <div className="space-y-2">
                <Label htmlFor="from-name">Отправитель</Label>
                <Input
                  id="from-name"
                  value={channelValues.fromName}
                  disabled={!canUpdate}
                  onChange={(event) => setChannels({ ...channelValues, fromName: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="from-email">Email отправителя</Label>
                <Input
                  id="from-email"
                  type="email"
                  value={channelValues.fromEmail}
                  disabled={!canUpdate}
                  onChange={(event) => setChannels({ ...channelValues, fromEmail: event.target.value })}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="bot-username">Имя Telegram-бота</Label>
                <Input
                  id="bot-username"
                  value={channelValues.telegramBotUsername}
                  disabled={!canUpdate}
                  placeholder="без @"
                  onChange={(event) => setChannels({ ...channelValues, telegramBotUsername: event.target.value })}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Матрица доставки" description="Кто получает событие и какими каналами.">
            {canUpdate && admin ? <AddRuleForm admin={admin} /> : null}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Событие</th>
                    <th className="py-2 pr-3 font-medium">Получатели</th>
                    <th className="py-2 pr-3 font-medium">В приложении</th>
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Telegram</th>
                    <th className="py-2 pr-3 font-medium">Вкл.</th>
                    {canUpdate ? <th className="py-2 font-medium" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {(admin?.rules ?? []).map((rule) => (
                    <tr key={rule.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3">{notificationEventLabels[rule.eventCode] ?? rule.eventCode}</td>
                      <td className="py-2 pr-3">
                        {rule.targetKind === 'role'
                          ? rule.roleName || 'Роль'
                          : notificationTargetLabels[rule.targetKind]}
                      </td>
                      <td className="py-2 pr-3">
                        <Checkbox
                          checked={rule.channelInApp}
                          disabled={!canUpdate || upsertRule.isPending}
                          onCheckedChange={(checked) => void handleToggle(rule, { channelInApp: checked === true })}
                          aria-label="В приложении"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Checkbox
                          checked={rule.channelEmail}
                          disabled={!canUpdate || upsertRule.isPending}
                          onCheckedChange={(checked) => void handleToggle(rule, { channelEmail: checked === true })}
                          aria-label="Email"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Checkbox
                          checked={rule.channelTelegram}
                          disabled={!canUpdate || upsertRule.isPending}
                          onCheckedChange={(checked) => void handleToggle(rule, { channelTelegram: checked === true })}
                          aria-label="Telegram"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Checkbox
                          checked={rule.isActive}
                          disabled={!canUpdate || upsertRule.isPending}
                          onCheckedChange={(checked) => void handleToggle(rule, { isActive: checked === true })}
                          aria-label="Включено"
                        />
                      </td>
                      {canUpdate ? (
                        <td className="py-2">
                          <IconActionButton
                            label="Удалить"
                            variant="ghost"
                            onClick={() => void handleDelete(rule.id)}
                          >
                            <Trash2 />
                          </IconActionButton>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              {(admin?.rules ?? []).length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">Правил пока нет.</p>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Ошибки доставки" description="Неуспешные письма и сообщения Telegram. На заказ это не влияет.">
            {(admin?.failedDeliveries ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Ошибок нет.</p>
            ) : (
              <ul className="space-y-2">
                {admin?.failedDeliveries.map((item) => (
                  <li key={item.id} className="rounded-md border px-3 py-2 text-sm">
                    <p className="font-medium">
                      {item.title} · {item.channel} · {item.recipientName}
                    </p>
                    <p className="text-destructive">{item.error || 'Ошибка доставки'}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(item.createdAt)} · попыток {item.attempts}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
    </div>
  )
}

function AddRuleForm({
  admin,
}: {
  admin: NonNullable<ReturnType<typeof useNotificationAdmin>['data']>
}) {
  const upsert = useUpsertNotificationRule()
  const [eventCode, setEventCode] = useState(admin.events[0]?.code ?? '')
  const [targetKind, setTargetKind] = useState<NotificationRule['targetKind']>('responsible')
  const [roleId, setRoleId] = useState(admin.roles[0]?.id ?? '')

  async function submit() {
    try {
      await upsert.mutateAsync({
        id: null,
        eventCode,
        targetKind,
        roleId: targetKind === 'role' ? roleId : null,
        channelInApp: true,
        channelEmail: false,
        channelTelegram: false,
        isActive: true,
      })
      toast.success('Правило добавлено')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="space-y-1">
        <Label>Событие</Label>
        <Select value={eventCode} onValueChange={setEventCode}>
          <SelectTrigger className="w-56" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {admin.events.map((event) => (
              <SelectItem key={event.code} value={event.code}>
                {event.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Получатели</Label>
        <Select
          value={targetKind}
          onValueChange={(value) => setTargetKind(value as NotificationRule['targetKind'])}
        >
          <SelectTrigger className="w-52" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(NotificationTarget).map((code) => (
              <SelectItem key={code} value={code}>
                {notificationTargetLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {targetKind === 'role' ? (
        <div className="space-y-1">
          <Label>Роль</Label>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger className="w-44" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {admin.roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <Button type="submit" size="sm" disabled={upsert.isPending || !eventCode}>
        Добавить
      </Button>
    </form>
  )
}
