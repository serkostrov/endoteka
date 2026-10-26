import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { History, Trash2, X } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { KeepAliveTab } from '@/components/shared/KeepAliveTab'
import { LoadingState } from '@/components/shared/LoadingState'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetExitPresence,
} from '@/components/ui/sheet'
import { useHasPermission } from '@/features/auth'
import { OrderWorkScopeTab } from '@/features/services'
import {
  OrderWorkCompositionProvider,
  useOrderWorkCompositionDraftOptional,
} from '@/features/services/lib/order-work-composition-draft'
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
import {
  OrderCardSaveProvider,
  useOrderCardSave,
} from '../lib/order-card-save-context'
import type { OrderDetail } from '../services/orders-service'

const tabs = [
  { id: 'overview', label: 'Общая информация' },
  { id: 'diagnostics', label: 'Диагностика' },
  { id: 'work', label: 'Состав работы' },
  { id: 'files', label: 'Файлы' },
] as const

type TabId = (typeof tabs)[number]['id']

export function OrderDetailSheet({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const presence = useSheetExitPresence(open, orderId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? (
        <OrderDetailSheetContent key={presence.id} orderId={presence.id} onClose={() => onOpenChange(false)} />
      ) : null}
    </Sheet>
  )
}

function OrderDetailSheetContent({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('work')
  const orderQuery = useOrder(orderId)

  return (
    <SheetContent
      side="right"
      showCloseButton={false}
      className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,72rem)]"
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Карточка заказа</SheetTitle>
        <SheetDescription>Просмотр и редактирование заказа. Доска остаётся на фоне.</SheetDescription>
      </SheetHeader>
      {orderQuery.isLoading ? (
        <LoadingState label="Загрузка заказа" className="min-h-64" />
      ) : orderQuery.error ? (
        <ErrorState description={getErrorMessage(orderQuery.error)} />
      ) : !orderQuery.data ? (
        <ErrorState description="Заказ не найден." />
      ) : (
        <OrderDetailCard
          order={orderQuery.data}
          layout="sheet"
          tab={tab}
          onTabChange={setTab}
          onDeleted={onClose}
        />
      )}
    </SheetContent>
  )
}

function OrderDetailCard({
  order,
  layout,
  tab,
  onTabChange,
  onDeleted,
  hideChromeDelete = false,
}: {
  order: OrderDetail
  layout: 'page' | 'sheet'
  tab: TabId
  onTabChange: (tab: TabId) => void
  onDeleted?: () => void
  hideChromeDelete?: boolean
}) {
  const navigate = useNavigate()
  const canDelete = useHasPermission(Permission.OrdersDelete)
  const remove = useDeleteOrder()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const inSheet = layout === 'sheet'
  const showHeaderDelete = canDelete && !hideChromeDelete

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
    <OrderCardSaveProvider>
      <OrderWorkCompositionProvider orderId={order.id}>
        <div
          className={cn(
            inSheet
              ? 'flex h-full min-h-0 flex-col overflow-hidden bg-background'
              : 'overflow-hidden rounded-xl border bg-card',
          )}
        >
          <div className={cn('flex flex-col lg:flex-row', inSheet && 'h-full min-h-0')}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <header className="border-b px-4 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
                    <h1 className="truncate text-lg font-semibold tracking-tight">Заказ {order.number}</h1>
                    <OrderStatusMenu
                      compact
                      orderId={order.id}
                      statusCode={order.statusCode}
                      statusName={order.statusName}
                    />
                    <OrderDeadlineHint order={order} className="h-6" />
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <IconActionButton
                      label="События"
                      className="lg:hidden"
                      onClick={() => setEventsOpen(true)}
                    >
                      <History />
                    </IconActionButton>
                    <OrderPrintMenu orderId={order.id} />
                    {showHeaderDelete ? (
                      <IconActionButton
                        label="Удалить заказ"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteOpen(true)}
                      >
                        <Trash2 />
                      </IconActionButton>
                    ) : null}
                    {inSheet ? (
                      <SheetClose asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label="Закрыть"
                        >
                          <X />
                        </Button>
                      </SheetClose>
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

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
                <KeepAliveTab active={tab === 'overview'}>
                  <OrderOverviewTab order={order} />
                </KeepAliveTab>
                <KeepAliveTab active={tab === 'diagnostics'}>
                  <OrderDiagnosticsTab orderId={order.id} />
                </KeepAliveTab>
                <KeepAliveTab active={tab === 'work'}>
                  <OrderWorkScopeTab orderId={order.id} />
                </KeepAliveTab>
                <KeepAliveTab active={tab === 'files'}>
                  <OrderAttachmentsTab orderId={order.id} />
                </KeepAliveTab>
              </div>

              <OrderCardFooter />
            </div>

            <aside
              className={cn(
                'hidden border-t bg-secondary/80 lg:flex lg:w-80 lg:shrink-0 lg:flex-col lg:border-t-0 lg:border-l xl:w-96',
                inSheet && 'lg:h-auto',
              )}
            >
              <div className={inSheet ? 'min-h-0 flex-1' : 'lg:h-[calc(100dvh-8rem)]'}>
                <OrderActivityFeed orderId={order.id} orderNumber={order.number} />
              </div>
            </aside>
          </div>

          <Sheet open={eventsOpen} onOpenChange={setEventsOpen}>
            <SheetContent
              side="bottom"
              className="flex h-[min(92dvh,40rem)] flex-col gap-0 overflow-hidden p-0 lg:hidden"
            >
              <SheetHeader className="shrink-0 border-b px-4 py-3 pr-14 text-left">
                <SheetTitle>События</SheetTitle>
                <SheetDescription>История заказа {order.number}</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1">
                {eventsOpen ? (
                  <OrderActivityFeed
                    orderId={order.id}
                    orderNumber={order.number}
                    hideHeader
                  />
                ) : null}
              </div>
            </SheetContent>
          </Sheet>

          {!hideChromeDelete ? (
            <ConfirmDialog
              open={deleteOpen}
              title="Удалить заказ"
              description={`Заказ ${order.number} будет удалён безвозвратно. Списания со склада останутся в журнале.`}
              confirmLabel="Удалить"
              isPending={remove.isPending}
              onOpenChange={setDeleteOpen}
              onConfirm={() => void handleDelete()}
            />
          ) : null}
        </div>
      </OrderWorkCompositionProvider>
    </OrderCardSaveProvider>
  )
}

function OrderCardFooter() {
  const cardSave = useOrderCardSave()
  const workDraft = useOrderWorkCompositionDraftOptional()
  const total = workDraft?.total ?? 0
  const showSave = Boolean(cardSave && (cardSave.dirty || cardSave.saving))

  return (
    <footer className="flex items-center justify-between gap-3 border-t px-4 py-3">
      <div className="min-w-0">
        {showSave ? (
          <Button
            type="button"
            disabled={cardSave?.saving}
            onClick={() => {
              void cardSave?.save().catch(() => {
                // toast already shown in tab persist
              })
            }}
          >
            {cardSave?.saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        ) : null}
      </div>
      <p className="shrink-0 text-sm">
        <span className="text-muted-foreground">Итого </span>
        <span className="font-semibold">{formatMoney(total)} ₽</span>
      </p>
    </footer>
  )
}
