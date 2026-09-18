import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Printer, Trash2 } from 'lucide-react'

import { useOpenEntitySheet } from '@/app/sheet-stack'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { DatePicker } from '@/components/shared/DatePicker'
import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { SheetEntityToolbar } from '@/components/shared/SheetEntityToolbar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetExitPresence,
} from '@/components/ui/sheet'
import { CustomerPicker } from '@/features/customers'
import { SaleDocumentsTab } from '@/features/documents'
import { ItemSearchField } from '@/features/inventory/components/ItemSearchField'
import { useHasPermission } from '@/features/auth'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { SaleStatus, saleStatusLabels, saleStatusTone } from '@/lib/constants/sales'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import type { InventoryItem } from '@/features/inventory/services/inventory-service'

import { SaleLinesBulkActions } from './SaleLinesBulkActions'
import { SalePrintDocument } from './SalePrintDocument'
import {
  useAddSaleLine,
  useCancelSale,
  useConfirmSale,
  useDeleteSale,
  useRemoveSaleLine,
  useSale,
  useSetSaleLine,
  useUpdateSale,
} from '../hooks/use-sales'
import type { SaleAllocation, SaleDocument, SaleFifoPreviewLine, SaleLine } from '../services/sales-service'

export function SaleDetailSheet({
  saleId,
  open,
  onOpenChange,
}: {
  saleId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const presence = useSheetExitPresence(open, saleId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? (
        <SaleDetailSheetContent key={presence.id} saleId={presence.id} onClose={() => onOpenChange(false)} />
      ) : null}
    </Sheet>
  )
}

function SaleDetailSheetContent({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const saleQuery = useSale(saleId)
  const canDelete = useHasPermission(Permission.SalesDelete)
  const remove = useDeleteSale()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const document = saleQuery.data
  const canRemove = Boolean(document && canDelete && document.status !== SaleStatus.Confirmed)

  async function handleDelete() {
    if (!document) {
      return
    }
    try {
      await remove.mutateAsync(document.id)
      toast.success('Счёт удалён')
      setDeleteOpen(false)
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(96vw,40rem)]"
      actions={
        document ? (
          <SheetEntityToolbar onDelete={canRemove ? () => setDeleteOpen(true) : undefined} />
        ) : null
      }
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Продажа</SheetTitle>
        <SheetDescription>Карточка счёта. Список остаётся на фоне.</SheetDescription>
      </SheetHeader>
      <div className="p-4 pr-14">
        {saleQuery.isLoading ? (
          <LoadingState label="Загрузка продажи" className="min-h-40" />
        ) : saleQuery.error ? (
          <ErrorState description={getErrorMessage(saleQuery.error)} />
        ) : !document ? (
          <ErrorState description="Продажа не найдена." />
        ) : (
          <SaleDocumentBody document={document} layout="sheet" hideChromeDelete onDeleted={onClose} />
        )}
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title="Удалить счёт"
        description={document ? `${document.invoiceNumber} будет удалён без возможности восстановления.` : ''}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />
    </SheetContent>
  )
}

function SaleDocumentBody({
  document,
  layout,
  onDeleted,
  hideChromeDelete = false,
}: {
  document: SaleDocument
  layout: 'page' | 'sheet'
  onDeleted?: () => void
  hideChromeDelete?: boolean
}) {
  const navigate = useNavigate()
  const openSheet = useOpenEntitySheet()
  const canCreate = useHasPermission(Permission.SalesCreate)
  const canUpdate = useHasPermission(Permission.SalesUpdate)
  const canDelete = useHasPermission(Permission.SalesDelete)
  const editable = document.status === SaleStatus.Draft && (canCreate || canUpdate)
  const canRemove = canDelete && document.status !== SaleStatus.Confirmed && !hideChromeDelete
  const confirm = useConfirmSale(document.id)
  const cancel = useCancelSale(document.id)
  const remove = useDeleteSale()
  const update = useUpdateSale(document.id)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const lineIdsKey = document.lines.map((line) => line.id).join('|')

  useEffect(() => {
    const visible = new Set(lineIdsKey ? lineIdsKey.split('|') : [])
    setSelectedIds((current) => {
      const next = current.filter((id) => visible.has(id))
      return next.length === current.length ? current : next
    })
  }, [lineIdsKey])

  const insufficient = document.lines.filter((line) => line.quantity > line.stockQuantity || !line.fifoPreview.enough)
  const canConfirm =
    canCreate &&
    editable &&
    Boolean(document.customerId) &&
    document.lines.length > 0 &&
    insufficient.length === 0

  async function handleConfirm() {
    try {
      await confirm.mutateAsync()
      toast.success('Продажа подтверждена, остаток списан: сначала самые ранние поступления.')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleCancel() {
    try {
      await cancel.mutateAsync()
      toast.success('Черновик отменён')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync(document.id)
      toast.success('Счёт удалён')
      setDeleteOpen(false)
      if (onDeleted) {
        onDeleted()
      } else {
        navigate(routes.sales)
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  function persistHeader(next: { customerId: string | null; saleDate: string; invoiceNumber: string }) {
    update.mutate(next, {
      onError: (error) => toast.error(getErrorMessage(error)),
    })
  }

  return (
    <>
      <div className="space-y-4 print:hidden">
        <PageHeader
          title={document.invoiceNumber}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="size-4" />
                Печать
              </Button>
              {canRemove ? (
                <IconActionButton
                  label="Удалить"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 />
                </IconActionButton>
              ) : null}
              {editable ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() => void handleCancel()}
                >
                  Отменить
                </Button>
              ) : null}
              {editable && canCreate ? (
                <Button type="button" size="sm" disabled={!canConfirm || confirm.isPending} onClick={() => void handleConfirm()}>
                  {confirm.isPending ? 'Подтверждение…' : 'Подтвердить продажу'}
                </Button>
              ) : null}
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={saleStatusTone(document.status)}>{saleStatusLabels[document.status]}</StatusBadge>
          <span className="text-sm text-muted-foreground">
            {document.createdByName ? `Оформил ${document.createdByName}` : 'Оформил —'}
            {document.confirmedAt ? ` · подтверждена ${formatDate(document.confirmedAt)}` : ''}
          </span>
        </div>

        <SectionCard title="Реквизиты">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Покупатель</Label>
              {editable ? (
                <CustomerPicker
                  value={document.customerId ?? ''}
                  onChange={(customer) =>
                    persistHeader({
                      customerId: customer?.id ?? null,
                      saleDate: document.saleDate,
                      invoiceNumber: document.invoiceNumber,
                    })
                  }
                />
              ) : (
                <p className="text-sm">
                  {document.customerName || '—'}
                  {document.customerInn ? ` · ИНН ${document.customerInn}` : ''}
                  {document.customerPhone ? ` · ${document.customerPhone}` : ''}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sale-invoice">Номер счёта</Label>
              <Input
                id="sale-invoice"
                key={`${document.id}-invoice-${document.invoiceNumber}`}
                defaultValue={document.invoiceNumber}
                disabled={!editable}
                onBlur={(event) => {
                  const next = event.target.value.trim()
                  if (!next || next === document.invoiceNumber) {
                    return
                  }
                  persistHeader({
                    customerId: document.customerId,
                    saleDate: document.saleDate,
                    invoiceNumber: next,
                  })
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sale-date">Дата</Label>
              <DatePicker
                id="sale-date"
                value={document.saleDate}
                disabled={!editable}
                allowClear={false}
                onChange={(next) => {
                  if (!next || next === document.saleDate) {
                    return
                  }
                  persistHeader({
                    customerId: document.customerId,
                    saleDate: next,
                    invoiceNumber: document.invoiceNumber,
                  })
                }}
              />
            </div>
          </div>
        </SectionCard>

        {insufficient.length > 0 ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Недостаточно остатка:{' '}
            {insufficient
              .map((line) => `${line.itemName} (нужно ${formatQuantity(line.quantity)}, доступно ${formatQuantity(line.stockQuantity)})`)
              .join('; ')}
            . Продажа с отрицательным остатком невозможна.
          </p>
        ) : null}

        <SectionCard
          title="Позиции"
          actions={<p className="text-sm font-medium">Итого {formatMoney(document.total)}</p>}
        >
          <div className="space-y-3">
            {editable ? <AddSaleLineForm saleId={document.id} /> : null}
            {!document.customerId && editable ? (
              <p className="text-sm text-muted-foreground">Укажите покупателя, чтобы подтвердить продажу.</p>
            ) : null}
            {selectedIds.length > 0 ? (
              <SaleLinesBulkActions
                saleId={document.id}
                selectedIds={selectedIds}
                lines={document.lines}
                editable={editable}
                onClear={() => setSelectedIds([])}
              />
            ) : null}
            <DataTable
              caption="Строки счёта"
              data={document.lines}
              getRowId={(row) => row.id}
              emptyTitle="Позиций нет"
              emptyDescription="Найдите товар выше и добавьте в счёт."
              dense
              framed
              selection={{
                selectedIds,
                onSelectedIdsChange: setSelectedIds,
              }}
              onRowClick={(row) => openSheet('item', row.itemId)}
              columns={saleLineColumns(document, editable)}
            />
          </div>
        </SectionCard>

        <SaleDocumentsTab saleId={document.id} invoiceNumber={document.invoiceNumber} />
      </div>

      {!hideChromeDelete ? (
        <ConfirmDialog
          open={deleteOpen}
          title="Удалить счёт"
          description={`${document.invoiceNumber} будет удалён без возможности восстановления.`}
          confirmLabel="Удалить"
          isPending={remove.isPending}
          onOpenChange={setDeleteOpen}
          onConfirm={() => void handleDelete()}
        />
      ) : null}

      <div className="hidden print:block">
        <SalePrintDocument document={document} />
      </div>
    </>
  )
}

function saleLineColumns(document: SaleDocument, editable: boolean): DataTableColumn<SaleLine>[] {
  const columns: DataTableColumn<SaleLine>[] = [
    {
      id: 'item',
      header: 'Позиция',
      className: 'min-w-[12rem]',
      cell: (row) => (
        <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
          <EntitySheetLink kind="item" id={row.itemId} className="font-medium">
            {row.itemName}
          </EntitySheetLink>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.itemCode}
            {row.itemArticle ? ` · ${row.itemArticle}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'qty',
      header: 'Кол-во',
      className: 'w-[1%]',
      cell: (row) =>
        editable ? (
          <div onClick={(event) => event.stopPropagation()}>
            <LineNumberInput line={row} field="quantity" saleId={document.id} />
          </div>
        ) : (
          <span className="tabular-nums">
            {formatQuantity(row.quantity)} {row.unitName}
          </span>
        ),
    },
    {
      id: 'price',
      header: 'Цена',
      className: 'w-[1%]',
      cell: (row) =>
        editable ? (
          <div onClick={(event) => event.stopPropagation()}>
            <LineNumberInput line={row} field="unitPrice" saleId={document.id} />
          </div>
        ) : (
          <span className="tabular-nums">{formatMoney(row.unitPrice)}</span>
        ),
    },
    {
      id: 'amount',
      header: 'Сумма',
      className: 'w-[1%] tabular-nums',
      cell: (row) => formatMoney(row.amount),
    },
    {
      id: 'stock',
      header: 'Ост',
      className: 'w-[1%]',
      cell: (row) => (
        <span
          className={cn(
            'tabular-nums',
            row.quantity > row.stockQuantity ? 'font-medium text-destructive' : undefined,
          )}
        >
          {formatQuantity(row.stockQuantity)}
        </span>
      ),
    },
    {
      id: 'fifo',
      header: 'Партии',
      className: 'hidden min-w-[8rem] lg:table-cell',
      cell: (row) => <FifoCell line={row} confirmed={document.status === SaleStatus.Confirmed} />,
    },
  ]

  if (editable) {
    columns.push({
      id: 'remove',
      header: '',
      className: 'w-[1%]',
      cell: (row) => (
        <div
          className="flex justify-end"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <RemoveLineButton saleId={document.id} lineId={row.id} />
        </div>
      ),
    })
  }

  return columns
}

function AddSaleLineForm({ saleId }: { saleId: string }) {
  const add = useAddSaleLine(saleId)
  const [picked, setPicked] = useState<InventoryItem | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [unitPrice, setUnitPrice] = useState(0)
  const exceedsStock = Boolean(picked && quantity > picked.stockQuantity)

  async function submit() {
    if (!picked) {
      toast.error('Выберите позицию')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error('Количество должно быть больше нуля')
      return
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }
    try {
      await add.mutateAsync({ itemId: picked.id, quantity, unitPrice })
      toast.success('Позиция добавлена')
      setPicked(null)
      setQuantity(1)
      setUnitPrice(0)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-2">
      <ItemSearchField
        selected={picked}
        onSelect={(item) => {
          setPicked(item)
          setQuantity(1)
          setUnitPrice(item.retailPrice)
        }}
        onClear={() => {
          setPicked(null)
          setUnitPrice(0)
        }}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="sale-add-qty">Кол-во</Label>
          <Input
            id="sale-add-qty"
            type="number"
            min={0.001}
            step="0.001"
            value={Number.isFinite(quantity) ? quantity : ''}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sale-add-price">Цена</Label>
          <Input
            id="sale-add-price"
            type="number"
            min={0}
            step="0.01"
            value={Number.isFinite(unitPrice) ? unitPrice : ''}
            onChange={(event) => setUnitPrice(Number(event.target.value))}
          />
        </div>
        <Button type="button" disabled={add.isPending || !picked} onClick={() => void submit()}>
          {add.isPending ? '…' : 'Добавить'}
        </Button>
      </div>
      {picked ? (
        <p className={cn('text-sm', exceedsStock ? 'text-destructive' : 'text-muted-foreground')}>
          Остаток {formatQuantity(picked.stockQuantity)} {picked.unitName}
          {exceedsStock ? '. Такого количества нет на складе.' : ''}
        </p>
      ) : null}
    </div>
  )
}

function LineNumberInput({
  line,
  field,
  saleId,
}: {
  line: SaleLine
  field: 'quantity' | 'unitPrice'
  saleId: string
}) {
  const setLine = useSetSaleLine(saleId)
  const current = field === 'quantity' ? line.quantity : line.unitPrice

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
    <Input
      key={`${line.id}-${field}-${current}`}
      type="number"
      min={field === 'quantity' ? 0.001 : 0}
      step={field === 'quantity' ? '0.001' : '0.01'}
      className="w-24"
      defaultValue={current}
      aria-label={field === 'quantity' ? 'Количество' : 'Цена'}
      onBlur={(event) => commit(event.target.value)}
    />
  )
}

function RemoveLineButton({ saleId, lineId }: { saleId: string; lineId: string }) {
  const remove = useRemoveSaleLine(saleId)

  return (
    <IconActionButton
      label="Удалить"
      variant="ghost"
      disabled={remove.isPending}
      onClick={() => {
        remove.mutate(lineId, {
          onError: (error) => toast.error(getErrorMessage(error)),
        })
      }}
    >
      <Trash2 />
    </IconActionButton>
  )
}

function fifoRowKey(row: SaleAllocation | SaleFifoPreviewLine) {
  if ('id' in row) {
    return row.id
  }
  return `${row.batchId}-${row.receiptDate}-${row.quantity}`
}

function FifoCell({ line, confirmed }: { line: SaleLine; confirmed: boolean }) {
  const rows = confirmed ? line.allocations : line.fifoPreview.lines
  if (rows.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {rows.map((row) => (
        <li key={fifoRowKey(row)}>
          {formatQuantity(row.quantity)}
          {row.receiptDate ? ` · ${formatDate(row.receiptDate)}` : ''}
          {row.supplier ? ` · ${row.supplier}` : ''}
        </li>
      ))}
    </ul>
  )
}
