import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { PageNavControls } from '@/app/layouts/PageNavControls'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useHasPermission } from '@/features/auth'
import { OrderWorkScopeTab } from '@/features/services'
import { useOrderServiceLines } from '@/features/services/hooks/use-services'
import { useOrderInventoryUsage } from '@/features/inventory/hooks/use-inventory'
import { formatMoney } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { OrderActivityFeed } from './OrderActivityFeed'
import { OrderAttachmentsTab } from './OrderAttachmentsTab'
import { OrderDeadlineHint } from './OrderBadges'
import { OrderDiagnosticsTab } from './OrderDiagnosticsTab'
import { OrderOverviewTab } from './OrderOverviewTab'
import { OrderPrintMenu } from './OrderPrintMenu'
import { OrderStatusMenu } from './OrderStatusActions'
import { useDeleteOrder, useOrder } from '../hooks/use-orders'
import type { OrderDetail } from '../services/orders-service'

const tabs = [
  { id: 'overview', label: 'Общая информация' },
  { id: 'diagnostics', label: 'Диагностика' },
  { id: 'work', label: 'Состав работы' },
  { id: 'files', label: 'Файлы' },
] as const

type TabId = (typeof tabs)[number]['id']

export function OrderDetailScreen() {
  const { id } = useParams()

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <PageNavControls />
      <OrderDetailPanel orderId={id} layout="page" />
    </div>
  )
}

export function OrderDetailSheet({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,72rem)]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Карточка заказа</SheetTitle>
          <SheetDescription>Просмотр и редактирование заказа. Доска остаётся на фоне.</SheetDescription>
        </SheetHeader>
        {open && orderId ? (
          <OrderDetailPanel
            key={orderId}
            orderId={orderId}
            layout="sheet"
            onDeleted={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function OrderDetailPanel({
  orderId,
  layout,
  onDeleted,
}: {
  orderId: string | undefined
  layout: 'page' | 'sheet'
  onDeleted?: () => void
}) {
  const [tab, setTab] = useState<TabId>('overview')
  const orderQuery = useOrder(orderId)

  if (orderQuery.isLoading) {
    return <LoadingState label="Загрузка заказа" className={layout === 'sheet' ? 'min-h-64' : undefined} />
  }

  if (orderQuery.error) {
    return <ErrorState description={getErrorMessage(orderQuery.error)} />
  }

  const order = orderQuery.data
  if (!order) {
    return <ErrorState description="Заказ не найден." />
  }

  return (
    <OrderDetailCard
      order={order}
      layout={layout}
      tab={tab}
      onTabChange={setTab}
      onDeleted={onDeleted}
    />
  )
}

function OrderDetailCard({
  order,
  layout,
  tab,
  onTabChange,
  onDeleted,
}: {
  order: OrderDetail
  layout: 'page' | 'sheet'
  tab: TabId
  onTabChange: (tab: TabId) => void
  onDeleted?: () => void
}) {
  const navigate = useNavigate()
  const canDelete = useHasPermission(Permission.OrdersDelete)
  const remove = useDeleteOrder()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const inSheet = layout === 'sheet'

  async function handleDelete() {
    try {
      await remove.mutateAsync(order.id)
      toast.success(`Заказ ${order.number} удалён`)
      setDeleteOpen(false)
      if (onDeleted) {
        onDeleted()
      } else {
        navigate(routes.orders)
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div
      className={cn(
        inSheet
          ? 'flex h-full min-h-0 flex-col overflow-hidden bg-background'
          : 'overflow-hidden rounded-xl border bg-card',
      )}
    >
      <div className={cn('flex flex-col lg:flex-row', inSheet && 'h-full min-h-0')}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className={cn('border-b px-4 py-2.5', inSheet && 'pr-12')}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">Заказ {order.number}</h1>
              <OrderStatusMenu
                compact
                orderId={order.id}
                statusCode={order.statusCode}
                statusName={order.statusName}
              />
              <OrderDeadlineHint order={order} className="h-6" />
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <OrderPrintMenu orderId={order.id} />
                {canDelete ? (
                  <IconActionButton
                    label="Удалить заказ"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 />
                  </IconActionButton>
                ) : null}
              </div>
            </div>
          </header>

          <div className="flex gap-1 overflow-x-auto border-b px-2">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'shrink-0 border-b-2 px-3 py-2.5 text-sm',
                  tab === item.id
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                onClick={() => onTabChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'overview' ? <OrderOverviewTab order={order} /> : null}
            {tab === 'diagnostics' ? <OrderDiagnosticsTab orderId={order.id} /> : null}
            {tab === 'work' ? <OrderWorkScopeTab orderId={order.id} /> : null}
            {tab === 'files' ? <OrderAttachmentsTab orderId={order.id} /> : null}
          </div>

          <OrderCardFooter orderId={order.id} />
        </div>

        <aside
          className={cn(
            'border-t lg:w-80 lg:shrink-0 lg:border-t-0 lg:border-l xl:w-96',
            inSheet && 'flex min-h-72 flex-col lg:h-auto',
          )}
        >
          <div className={inSheet ? 'min-h-0 flex-1' : 'lg:h-[calc(100dvh-8rem)]'}>
            <OrderActivityFeed orderId={order.id} orderNumber={order.number} />
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить заказ"
        description={`Заказ ${order.number} будет удалён безвозвратно. Списания со склада останутся в журнале.`}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}

function OrderCardFooter({ orderId }: { orderId: string }) {
  const usageQuery = useOrderInventoryUsage(orderId)
  const servicesQuery = useOrderServiceLines(orderId)
  const partsTotal = (usageQuery.data ?? []).reduce((sum, row) => sum + Math.abs(row.quantity) * row.unitPrice, 0)
  const servicesTotal = (servicesQuery.data ?? []).reduce((sum, row) => sum + row.quantity * row.unitPrice, 0)
  const total = partsTotal + servicesTotal

  return (
    <footer className="flex items-center justify-end border-t px-4 py-3">
      <p className="text-sm">
        <span className="text-muted-foreground">Итого </span>
        <span className="font-semibold">{formatMoney(total)} ₽</span>
      </p>
    </footer>
  )
}
