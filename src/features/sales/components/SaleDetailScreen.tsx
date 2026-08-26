import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Printer, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { DatePicker } from '@/components/shared/DatePicker'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export function SaleDetailScreen() {
  const { id } = useParams()
  const saleQuery = useSale(id)

  if (saleQuery.isLoading) {
    return <LoadingState label="Загрузка продажи" />
  }

  if (saleQuery.error) {
    return <ErrorState description={getErrorMessage(saleQuery.error)} />
  }

  const document = saleQuery.data
  if (!document) {
    return <ErrorState description="Продажа не найдена." />
  }

  return <SaleDocumentBody document={document} />
}

function SaleDocumentBody({ document }: { document: SaleDocument }) {
  const navigate = useNavigate()
  const canCreate = useHasPermission(Permission.SalesCreate)
  const canUpdate = useHasPermission(Permission.SalesUpdate)
  const canDelete = useHasPermission(Permission.SalesDelete)
  const editable = document.status === SaleStatus.Draft && (canCreate || canUpdate)
  const canRemove = canDelete && document.status !== SaleStatus.Confirmed
  const confirm = useConfirmSale(document.id)
  const cancel = useCancelSale(document.id)
  const remove = useDeleteSale()
  const update = useUpdateSale(document.id)
  const [deleteOpen, setDeleteOpen] = useState(false)
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
      toast.success('Продажа подтверждена, остаток списан FIFO')
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
      navigate(routes.sales)
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
          description="Счёт внешнему клиенту. Списание со склада — только после подтверждения."
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

        {editable ? <AddSaleLineCard saleId={document.id} /> : null}

        {insufficient.length > 0 ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Недостаточно остатка:{' '}
            {insufficient
              .map((line) => `${line.itemName} (нужно ${formatQuantity(line.quantity)}, доступно ${formatQuantity(line.stockQuantity)})`)
              .join('; ')}
            . Продажа с отрицательным остатком невозможна.
          </p>
        ) : null}

        {!document.customerId && editable ? (
          <p className="text-sm text-muted-foreground">Укажите покупателя, чтобы подтвердить продажу.</p>
        ) : null}

        <SectionCard
          title="Позиции"
          description={editable ? 'Остаток проверяется до подтверждения. Списание FIFO — одной транзакцией.' : undefined}
          actions={<p className="text-sm font-medium">Итого {formatMoney(document.total)}</p>}
        >
          <DataTable
            caption="Строки счёта"
            data={document.lines}
            getRowId={(row) => row.id}
            emptyTitle="Позиций нет"
            emptyDescription="Добавьте товар и укажите количество."
            columns={saleLineColumns(document, editable)}
          />
        </SectionCard>

        <SaleDocumentsTab saleId={document.id} invoiceNumber={document.invoiceNumber} />
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить счёт"
        description={`${document.invoiceNumber} будет удалён без возможности восстановления.`}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />

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
      cell: (row) => (
        <div>
          <p>{row.itemName}</p>
          <p className="text-xs text-muted-foreground">
            {row.itemCode}
            {row.itemArticle ? ` · ${row.itemArticle}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'qty',
      header: 'Кол-во',
      cell: (row) =>
        editable ? (
          <LineNumberInput line={row} field="quantity" saleId={document.id} />
        ) : (
          `${formatQuantity(row.quantity)} ${row.unitName}`
        ),
    },
    {
      id: 'price',
      header: 'Цена',
      cell: (row) =>
        editable ? <LineNumberInput line={row} field="unitPrice" saleId={document.id} /> : formatMoney(row.unitPrice),
    },
    { id: 'amount', header: 'Сумма', cell: (row) => formatMoney(row.amount) },
    {
      id: 'stock',
      header: 'Остаток',
      cell: (row) => (
        <span className={cn(row.quantity > row.stockQuantity ? 'font-medium text-destructive' : undefined)}>
          {formatQuantity(row.stockQuantity)} {row.unitName}
        </span>
      ),
    },
    {
      id: 'fifo',
      header: 'Партии',
      cell: (row) => <FifoCell line={row} confirmed={document.status === SaleStatus.Confirmed} />,
    },
  ]

  if (editable) {
    columns.push({
      id: 'remove',
      header: '',
      cell: (row) => <RemoveLineButton saleId={document.id} lineId={row.id} />,
    })
  }

  return columns
}

function AddSaleLineCard({ saleId }: { saleId: string }) {
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
    <SectionCard title="Добавить позицию" description="Перед подтверждением видно, хватит ли остатка.">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_8rem_auto] md:items-end">
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
        <div className="space-y-2">
          <Label htmlFor="sale-add-qty">Количество</Label>
          <Input
            id="sale-add-qty"
            type="number"
            min={0.001}
            step="0.001"
            value={Number.isFinite(quantity) ? quantity : ''}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
        </div>
        <div className="space-y-2">
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
          {add.isPending ? 'Добавление…' : 'Добавить'}
        </Button>
      </div>
      {picked ? (
        <p className={cn('mt-3 text-sm', exceedsStock ? 'text-destructive' : 'text-muted-foreground')}>
          Остаток {formatQuantity(picked.stockQuantity)} {picked.unitName}
          {exceedsStock ? '. Такого количества нет на складе.' : ''}
        </p>
      ) : null}
    </SectionCard>
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
