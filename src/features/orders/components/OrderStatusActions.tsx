import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DatePicker } from '@/components/shared/DatePicker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { useWarrantyDefaults } from '@/features/devices/hooks/use-devices'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { OrderStatusBadge } from './OrderBadges'
import { useChangeOrderStatus, useOrderStatusCatalog } from '../hooks/use-orders'
import { groupStatusCatalog, statusBadgeStyle, type OrderStatusCatalogItem } from '../lib/status-catalog'

type OrderStatusMenuProps = {
  orderId: string
  statusCode: string
  statusName: string
  compact?: boolean
}

export function OrderStatusMenu({ orderId, statusCode, statusName, compact = false }: OrderStatusMenuProps) {
  const [open, setOpen] = useState(false)
  const catalogQuery = useOrderStatusCatalog()
  const changeStatus = useChangeOrderStatus(orderId)
  const [target, setTarget] = useState<OrderStatusCatalogItem | null>(null)
  const [warrantyDraft, setWarrantyDraft] = useState<{ start: string; end: string } | null>(null)
  const isIssue = Boolean(target?.requiresWarranty)
  const defaultsQuery = useWarrantyDefaults(Boolean(target) && Boolean(isIssue))
  const isDestructive = Boolean(target?.isDestructive)
  const warrantyStart = warrantyDraft?.start ?? defaultsQuery.data?.startsOn ?? ''
  const warrantyEnd = warrantyDraft?.end ?? defaultsQuery.data?.endsOn ?? ''
  const groups = groupStatusCatalog((catalogQuery.data ?? []).filter((item) => item.isActive && item.code !== statusCode))

  async function applyStatus(status: OrderStatusCatalogItem, warranty?: { start: string; end: string } | null) {
    try {
      await changeStatus.mutateAsync({
        statusId: status.id,
        warranty: status.requiresWarranty ? warranty ?? null : null,
      })
      toast.success(`Статус: ${status.name}`)
      setTarget(null)
      setWarrantyDraft(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function confirm() {
    if (!target) {
      return
    }

    if (isIssue && (!warrantyStart || !warrantyEnd)) {
      toast.error('Укажите срок гарантии.')
      return
    }

    await applyStatus(target, isIssue ? { start: warrantyStart, end: warrantyEnd } : null)
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={compact ? 'xs' : 'sm'}
            className={cn('gap-1 px-1', compact && 'h-6 py-0')}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Статус: ${statusName}`}
          >
            <OrderStatusBadge code={statusCode} name={statusName} />
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto" onClick={(event) => event.stopPropagation()}>
          <DropdownMenuLabel>Сменить статус</DropdownMenuLabel>
          {catalogQuery.isLoading ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Загрузка…</p>
          ) : catalogQuery.error ? (
            <p className="px-2 py-1.5 text-sm text-destructive">{getErrorMessage(catalogQuery.error)}</p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Других статусов нет.</p>
          ) : (
            groups.map((group, index) => (
              <div key={group.id}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel className="text-xs font-medium text-foreground">{group.name}</DropdownMenuLabel>
                {group.statuses.map((status) => (
                  <DropdownMenuItem
                    key={status.id}
                    variant={status.isDestructive ? 'destructive' : 'default'}
                    onSelect={() => {
                      if (status.requiresWarranty || status.isDestructive) {
                        setWarrantyDraft(null)
                        setTarget(status)
                        return
                      }
                      void applyStatus(status)
                    }}
                  >
                    <span
                      className="rounded-md px-1.5 py-0.5 text-xs font-medium"
                      style={statusBadgeStyle(status.color || status.groupColor)}
                    >
                      {status.name}
                    </span>
                  </DropdownMenuItem>
                ))}
              </div>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={(openDialog) => {
          if (!openDialog) {
            setTarget(null)
            setWarrantyDraft(null)
          }
        }}
        title={isDestructive ? 'Отказ' : isIssue ? 'Выдача и гарантия' : 'Сменить статус'}
        description={
          target
            ? isIssue
              ? `Заказ будет переведён в статус «${target.name}». Срок гарантии сохраняется на сервере.`
              : `Заказ будет переведён в статус «${target.name}». Действие запишется в журнал.`
            : ''
        }
        confirmLabel={isDestructive ? 'Подтвердить отказ' : isIssue ? 'Выдать' : 'Сменить статус'}
        confirmVariant={isDestructive ? 'destructive' : 'default'}
        isPending={changeStatus.isPending}
        onConfirm={() => void confirm()}
      >
        {isIssue ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="warranty-start">Начало гарантии</Label>
              <DatePicker
                id="warranty-start"
                value={warrantyStart}
                allowClear={false}
                onChange={(next) => setWarrantyDraft({ start: next, end: warrantyEnd })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="warranty-end">Окончание гарантии</Label>
              <DatePicker
                id="warranty-end"
                value={warrantyEnd}
                allowClear={false}
                onChange={(next) => setWarrantyDraft({ start: warrantyStart, end: next })}
              />
            </div>
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Даты — черновик для формы. Статус гарантии считается в базе по текущей дате сервера.
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
