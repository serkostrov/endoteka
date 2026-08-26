import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import { useReferenceItemsBySetCode } from '@/features/references'
import { Permission } from '@/lib/constants/permissions'
import { ReferenceSetCode } from '@/lib/constants/references'
import { getErrorMessage } from '@/lib/errors'

import {
  useOrderAppSettings,
  useProcessOrderDeadlines,
  useSetOrderNumberStart,
  useTransitionRuleTypes,
  useUpsertOrderTransition,
  useDeleteOrderTransition,
  useWorkflowTransitions,
} from '../hooks/use-orders'
import { orderNumberStartSchema, workflowTransitionSchema, type WorkflowTransitionFormValues } from '../schemas'
import type { WorkflowTransition } from '../services/orders-service'

const TRANSITION_PERMISSIONS = [
  { code: Permission.OrdersChangeStatus, label: 'Смена статуса' },
  { code: Permission.OrdersUpdate, label: 'Изменение заказа' },
  { code: Permission.DiagnosticsUpdate, label: 'Диагностика' },
  { code: Permission.OrdersAssign, label: 'Назначение' },
]

export function OrderWorkflowScreen() {
  const canUpdate = useHasPermission(Permission.SettingsUpdate)
  const settingsQuery = useOrderAppSettings()
  const transitionsQuery = useWorkflowTransitions()
  const rulesQuery = useTransitionRuleTypes()
  const statuses = useReferenceItemsBySetCode(ReferenceSetCode.OrderStatuses)
  const setStart = useSetOrderNumberStart()
  const processDeadlines = useProcessOrderDeadlines()
  const upsert = useUpsertOrderTransition()
  const remove = useDeleteOrderTransition()
  const [editor, setEditor] = useState<WorkflowTransition | null | 'new'>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkflowTransition | null>(null)

  const [startDraft, setStartDraft] = useState<number | null>(null)
  const startValue = startDraft ?? settingsQuery.data?.start ?? 1

  async function saveStart() {
    const parsed = orderNumberStartSchema.safeParse({ start: startValue })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Укажите начальный номер')
      return
    }

    try {
      await setStart.mutateAsync(parsed.data.start)
      setStartDraft(null)
      toast.success('Начальный номер обновлён')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function checkDeadlines() {
    try {
      const sent = await processDeadlines.mutateAsync()
      toast.success(sent > 0 ? `Отправлено уведомлений: ${sent}` : 'Просроченных и ближних сроков нет')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Маршрут заказов"
        description="Нумерация, допустимые переходы статусов и проверка сроков."
      />

      <SectionCard
        title="Нумерация"
        description={`Следующий номер ориентировочно: ${settingsQuery.data?.nextNumber ?? '—'}. Фактический номер выдаёт база при создании.`}
      >
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void saveStart()
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="order-number-start">
              Начальный номер
            </label>
            <Input
              id="order-number-start"
              type="number"
              min={1}
              className="w-32"
              disabled={!canUpdate}
              value={Number.isFinite(startValue) ? startValue : ''}
              onChange={(event) => setStartDraft(event.target.valueAsNumber)}
            />
          </div>
          {canUpdate ? (
            <Button type="submit" disabled={setStart.isPending}>
              {setStart.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          ) : null}
        </form>
      </SectionCard>

      <SectionCard
        title="Сроки"
        description={`Уведомление ответственному за ${settingsQuery.data?.approachingDays ?? 2} дн. до срока и при просрочке. Получатели задаются маршрутами уведомлений, не интерфейсом.`}
        actions={
          canUpdate ? (
            <Button type="button" variant="outline" size="sm" disabled={processDeadlines.isPending} onClick={() => void checkDeadlines()}>
              {processDeadlines.isPending ? 'Проверка…' : 'Проверить сроки'}
            </Button>
          ) : null
        }
      >
        <p className="text-sm text-muted-foreground">
          Фоновая проверка выполняется функцией process-deadlines. Кнопка нужна для ручного запуска.
        </p>
      </SectionCard>

      <SectionCard
        title="Переходы статусов"
        description="Произвольная смена статуса запрещена. Каждый переход требует право и может требовать данные."
        actions={
          canUpdate ? (
            <Button type="button" size="sm" onClick={() => setEditor('new')}>
              Добавить переход
            </Button>
          ) : null
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Из</th>
                <th className="py-2 pr-3 font-medium">В</th>
                <th className="py-2 pr-3 font-medium">Право</th>
                <th className="py-2 pr-3 font-medium">Правила</th>
                <th className="py-2 pr-3 font-medium">Статус</th>
                {canUpdate ? <th className="py-2 font-medium"> </th> : null}
              </tr>
            </thead>
            <tbody>
              {(transitionsQuery.data ?? []).map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">{row.fromStatusName}</td>
                  <td className="py-2 pr-3">{row.toStatusName}</td>
                  <td className="py-2 pr-3">{permissionLabel(row.requiredPermission)}</td>
                  <td className="py-2 pr-3">
                    {row.ruleCodes.length > 0
                      ? row.ruleCodes
                          .map((code) => rulesQuery.data?.find((item) => item.code === code)?.name ?? code)
                          .join(', ')
                      : '—'}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>
                      {row.isActive ? 'Включён' : 'Выключен'}
                    </StatusBadge>
                  </td>
                  {canUpdate ? (
                    <td className="py-2">
                      <div className="flex gap-1">
                        <IconActionButton label="Изменить" variant="ghost" onClick={() => setEditor(row)}>
                          <Pencil />
                        </IconActionButton>
                        <IconActionButton
                          label="Удалить"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 />
                        </IconActionButton>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <TransitionDialog
        open={editor !== null}
        transition={editor === 'new' || editor === null ? null : editor}
        statuses={(statuses.data ?? []).filter((item) => item.isActive)}
        ruleTypes={rulesQuery.data ?? []}
        canSubmit={!upsert.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setEditor(null)
          }
        }}
        onSubmit={async (values) => {
          try {
            await upsert.mutateAsync({
              id: editor === 'new' || editor === null ? undefined : editor.id,
              fromStatusId: values.fromStatusId,
              toStatusId: values.toStatusId,
              requiredPermission: values.requiredPermission,
              ruleCodes: values.ruleCodes,
              isActive: values.isActive,
            })
            toast.success('Переход сохранён')
            setEditor(null)
          } catch (error) {
            toast.error(getErrorMessage(error))
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить переход"
        description={
          deleteTarget
            ? `Переход «${deleteTarget.fromStatusName} → ${deleteTarget.toStatusName}» будет удалён. Сменить статус по этому пути больше будет нельзя.`
            : ''
        }
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        onConfirm={() => {
          if (!deleteTarget) {
            return
          }
          void remove.mutateAsync(deleteTarget.id).then(
            () => {
              toast.success('Переход удалён')
              setDeleteTarget(null)
            },
            (error) => toast.error(getErrorMessage(error)),
          )
        }}
      />
    </div>
  )
}

function permissionLabel(code: string) {
  return TRANSITION_PERMISSIONS.find((item) => item.code === code)?.label ?? code
}

function TransitionDialog({
  open,
  transition,
  statuses,
  ruleTypes,
  canSubmit,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  transition: WorkflowTransition | null
  statuses: { id: string; name: string }[]
  ruleTypes: { code: string; name: string; description: string | null }[]
  canSubmit: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: WorkflowTransitionFormValues) => Promise<void>
}) {
  const form = useForm<WorkflowTransitionFormValues>({
    resolver: zodResolver(workflowTransitionSchema),
    values: {
      fromStatusId: transition?.fromStatusId ?? '',
      toStatusId: transition?.toStatusId ?? '',
      requiredPermission: transition?.requiredPermission ?? Permission.OrdersChangeStatus,
      ruleCodes: transition?.ruleCodes ?? [],
      isActive: transition?.isActive ?? true,
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{transition ? 'Изменить переход' : 'Новый переход'}</DialogTitle>
          <DialogDescription>Укажите исходный и целевой статусы, право и условия.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FormField
              control={form.control}
              name="fromStatusId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Из статуса</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Выберите статус" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {statuses.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="toStatusId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>В статус</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Выберите статус" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {statuses.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="requiredPermission"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Требуемое право</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TRANSITION_PERMISSIONS.map((item) => (
                        <SelectItem key={item.code} value={item.code}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ruleCodes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Условия</FormLabel>
                  <div className="space-y-2">
                    {ruleTypes.map((rule) => {
                      const checked = field.value.includes(rule.code)
                      return (
                        <label key={rule.code} className="flex items-start gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(next) => {
                              if (next === true) {
                                field.onChange([...field.value, rule.code])
                              } else {
                                field.onChange(field.value.filter((code) => code !== rule.code))
                              }
                            }}
                          />
                          <span>
                            <span className="font-medium">{rule.name}</span>
                            {rule.description ? (
                              <span className="block text-muted-foreground">{rule.description}</span>
                            ) : null}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={field.value} onCheckedChange={(next) => field.onChange(next === true)} />
                    Переход включён
                  </label>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
