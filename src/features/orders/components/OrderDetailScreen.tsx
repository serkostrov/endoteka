import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronDown, Printer } from 'lucide-react'

import { PageNavControls } from '@/app/layouts/PageNavControls'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CreateDocumentDialog } from '@/features/documents/components/CreateDocumentDialog'
import { OrderDocumentsTab } from '@/features/documents'
import { useDocuments } from '@/features/documents/hooks/use-documents'
import { OrderTasksTab } from '@/features/tasks'
import { OrderPartsTab } from '@/features/inventory'
import { useHasPermission } from '@/features/auth'
import { useOrderInventoryUsage } from '@/features/inventory/hooks/use-inventory'
import { DocumentSourceType } from '@/lib/constants/documents'
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
import { OrderStatusMenu } from './OrderStatusActions'
import { useOrder } from '../hooks/use-orders'
import type { OrderDetail } from '../services/orders-service'

const tabs = [
  { id: 'overview', label: 'Общая информация' },
  { id: 'diagnostics', label: 'Диагностика' },
  { id: 'parts', label: 'Запчасти' },
  { id: 'documents', label: 'Документы' },
  { id: 'files', label: 'Файлы' },
  { id: 'tasks', label: 'Задачи' },
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
        {open && orderId ? <OrderDetailPanel key={orderId} orderId={orderId} layout="sheet" /> : null}
      </SheetContent>
    </Sheet>
  )
}

function OrderDetailPanel({ orderId, layout }: { orderId: string | undefined; layout: 'page' | 'sheet' }) {
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

  return <OrderDetailCard order={order} layout={layout} tab={tab} onTabChange={setTab} />
}

function OrderDetailCard({
  order,
  layout,
  tab,
  onTabChange,
}: {
  order: OrderDetail
  layout: 'page' | 'sheet'
  tab: TabId
  onTabChange: (tab: TabId) => void
}) {
  const inSheet = layout === 'sheet'

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
          <header className={cn('border-b px-4 py-3', inSheet && 'pr-12')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-tight">Заказ {order.number}</h1>
              </div>
              <OrderDeadlineHint order={order} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <OrderStatusMenu orderId={order.id} statusCode={order.statusCode} statusName={order.statusName} />
              <div className="flex flex-wrap items-center gap-1">
                <OrderPrintMenu orderId={order.id} orderNumber={order.number} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Действия
                      <ChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link to={routes.customer.replace(':id', order.customerId)}>Открыть клиента</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to={routes.device.replace(':id', order.deviceId)}>Открыть прибор</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
            {tab === 'diagnostics' ? (
              <OrderDiagnosticsTab orderId={order.id} statusCode={order.statusCode} />
            ) : null}
            {tab === 'parts' ? <OrderPartsTab orderId={order.id} /> : null}
            {tab === 'documents' ? <OrderDocumentsTab orderId={order.id} orderNumber={order.number} /> : null}
            {tab === 'files' ? <OrderAttachmentsTab orderId={order.id} /> : null}
            {tab === 'tasks' ? <OrderTasksTab orderId={order.id} orderNumber={order.number} /> : null}
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
            <OrderActivityFeed orderId={order.id} />
          </div>
        </aside>
      </div>
    </div>
  )
}

function OrderPrintMenu({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const canRead = useHasPermission(Permission.DocumentsRead)
  const canCreate = useHasPermission(Permission.DocumentsCreate)
  const [createOpen, setCreateOpen] = useState(false)
  const documentsQuery = useDocuments({
    search: '',
    kind: 'all',
    sourceType: DocumentSourceType.Order,
    sourceId: orderId,
    page: 1,
    pageSize: 20,
  })
  const documents = documentsQuery.data?.items ?? []

  if (!canRead && !canCreate) {
    return null
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" aria-label="Печать">
            <Printer className="size-4" />
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {documents.length === 0 ? (
            <DropdownMenuItem disabled>Документов пока нет</DropdownMenuItem>
          ) : (
            documents.map((document) => (
              <DropdownMenuItem key={document.id} asChild>
                <Link to={routes.documentPrint.replace(':id', document.id)}>{document.title || document.number}</Link>
              </DropdownMenuItem>
            ))
          )}
          {canCreate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCreateOpen(true)}>Создать документ</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateDocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        presetSourceType={DocumentSourceType.Order}
        presetSourceId={orderId}
        presetSourceLabel={orderNumber}
      />
    </>
  )
}

function OrderCardFooter({ orderId }: { orderId: string }) {
  const usageQuery = useOrderInventoryUsage(orderId)
  const total = (usageQuery.data ?? []).reduce((sum, row) => sum + Math.abs(row.quantity) * row.unitPrice, 0)

  return (
    <footer className="flex items-center justify-end border-t px-4 py-3">
      <p className="text-sm">
        <span className="text-muted-foreground">Итого </span>
        <span className="font-semibold">{formatMoney(total)} ₽</span>
      </p>
    </footer>
  )
}
