import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { SectionCard } from '@/components/shared/SectionCard'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useHasPermission } from '@/features/auth'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

import { CreateServiceTemplateDialog } from './CreateServiceTemplateDialog'
import { ServiceSearchField } from './ServiceSearchField'
import {
  useAddOrderServiceLine,
  useOrderServiceLines,
  useRemoveOrderServiceLine,
  useSetOrderServiceLine,
} from '../hooks/use-services'
import type { OrderServiceLine, ServiceTemplate } from '../services/services-service'

export function OrderServicesBlock({ orderId }: { orderId: string }) {
  const canUpdate = useHasPermission(Permission.OrdersUpdate)
  const linesQuery = useOrderServiceLines(orderId)
  const add = useAddOrderServiceLine(orderId)
  const [createOpen, setCreateOpen] = useState(false)
  const [createQuery, setCreateQuery] = useState('')
  const addInFlight = useRef(false)
  const lines = linesQuery.data ?? []

  async function addTemplate(item: ServiceTemplate) {
    if (addInFlight.current) {
      return
    }
    addInFlight.current = true
    try {
      await add.mutateAsync({ templateId: item.id, quantity: 1, unitPrice: item.unitPrice })
      toast.success(`Добавлено: ${item.name}`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      addInFlight.current = false
    }
  }

  return (
    <SectionCard title="Услуги" description="Количество и цена задаются для этого заказа.">
      {canUpdate ? (
        <div className="mb-4">
          <ServiceSearchField
            disabled={add.isPending}
            onSelect={(item) => void addTemplate(item)}
            allowCreate
            onCreateRequest={(query) => {
              setCreateQuery(query)
              setCreateOpen(true)
            }}
          />
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">Нет права на изменение состава заказа.</p>
      )}

      {linesQuery.error ? (
        <ErrorState
          description={getErrorMessage(linesQuery.error)}
          onRetry={() => void linesQuery.refetch()}
          className="py-8"
        />
      ) : linesQuery.isLoading ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : lines.length === 0 ? (
        <EmptyState
          title="Услуги не добавлялись"
          description="Найдите шаблон или создайте новый, затем укажите количество и цену."
          className="py-8"
        />
      ) : (
        <ul className="grid gap-1.5">
          {lines.map((line) => (
            <li key={line.id}>
              <OrderServiceCard line={line} orderId={orderId} canUpdate={canUpdate} />
            </li>
          ))}
        </ul>
      )}

      <CreateServiceTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialQuery={createQuery}
        onCreated={(item) => void addTemplate(item)}
      />
    </SectionCard>
  )
}

function OrderServiceCard({
  line,
  orderId,
  canUpdate,
}: {
  line: OrderServiceLine
  orderId: string
  canUpdate: boolean
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const remove = useRemoveOrderServiceLine(orderId)
  const amount = line.quantity * line.unitPrice

  return (
    <article className="rounded-lg border bg-card px-2.5 py-2 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/50">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="min-w-0 truncate text-sm font-medium">{line.name}</p>
            {line.description ? (
              <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{line.description}</span>
            ) : null}
          </div>
          {line.description ? <p className="truncate text-xs text-muted-foreground sm:hidden">{line.description}</p> : null}
        </div>
        {canUpdate ? (
          <IconActionButton
            label="Удалить из заказа"
            variant="ghost"
            size="icon-xs"
            className="-mt-0.5 -mr-1 shrink-0 text-destructive hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
          </IconActionButton>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
        <ServiceNumberField
          line={line}
          orderId={orderId}
          field="quantity"
          label="Кол-во"
          disabled={!canUpdate}
        />
        <ServiceNumberField
          line={line}
          orderId={orderId}
          field="unitPrice"
          label="Цена"
          suffix="₽"
          disabled={!canUpdate}
        />
        <div className="min-w-16 space-y-0.5">
          <p className="text-[11px] leading-none text-muted-foreground">Сумма</p>
          <p className="flex h-7 items-center text-sm font-medium tabular-nums">{formatMoney(amount)} ₽</p>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить услугу"
        description={`«${line.name}» будет убрана из заказа.`}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          remove.mutate(line.id, {
            onSuccess: () => {
              setDeleteOpen(false)
              toast.success('Услуга удалена из заказа')
            },
            onError: (error) => toast.error(getErrorMessage(error)),
          })
        }}
      />
    </article>
  )
}

function ServiceNumberField({
  line,
  orderId,
  field,
  label,
  suffix,
  disabled,
}: {
  line: OrderServiceLine
  orderId: string
  field: 'quantity' | 'unitPrice'
  label: string
  suffix?: string
  disabled: boolean
}) {
  const setLine = useSetOrderServiceLine(orderId)
  const current = field === 'quantity' ? line.quantity : line.unitPrice
  const fieldId = `${line.id}-${field}`

  function commit(raw: string) {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed === current) {
      return
    }
    if (field === 'quantity' && parsed <= 0) {
      toast.error('Количество должно быть больше нуля')
      return
    }
    if (field === 'unitPrice' && parsed < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }
    setLine.mutate(
      {
        lineId: line.id,
        quantity: field === 'quantity' ? parsed : line.quantity,
        unitPrice: field === 'unitPrice' ? parsed : line.unitPrice,
      },
      { onError: (error) => toast.error(getErrorMessage(error)) },
    )
  }

  return (
    <div className="space-y-0.5">
      <Label htmlFor={fieldId} className="text-[11px] font-normal leading-none text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1">
        {disabled ? (
          <p id={fieldId} className="flex h-7 items-center text-sm tabular-nums">
            {field === 'quantity' ? formatQuantity(current) : `${formatMoney(current)} ₽`}
          </p>
        ) : (
          <Input
            id={fieldId}
            key={`${line.id}-${field}-${current}`}
            type="number"
            min={field === 'quantity' ? 0.001 : 0}
            step={field === 'quantity' ? '0.001' : '0.01'}
            className="h-7 w-[4.75rem] px-2 tabular-nums"
            defaultValue={current}
            disabled={setLine.isPending}
            onBlur={(event) => commit(event.target.value)}
          />
        )}
        {suffix && !disabled ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  )
}
