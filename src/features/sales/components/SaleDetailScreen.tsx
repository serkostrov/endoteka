import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { useOpenEntitySheet } from '@/app/sheet-stack'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DatePicker } from '@/components/shared/DatePicker'
import { EmptyState } from '@/components/shared/EmptyState'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CustomerPicker } from '@/features/customers'
import { SaleDocumentsTab } from '@/features/documents'
import { ItemSearchField } from '@/features/inventory/components/ItemSearchField'
import { useHasPermission } from '@/features/auth'
import { formatMoney, formatQuantity, parseQuantity } from '@/lib/constants/inventory'
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

const cellPad = 'px-2 py-1.5'
const spinless =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

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
      className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(96vw,56rem)]"
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
          <SaleDocumentBody document={document} hideChromeDelete onDeleted={onClose} />
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
  onDeleted,
  hideChromeDelete = false,
}: {
  document: SaleDocument
  onDeleted?: () => void
  hideChromeDelete?: boolean
}) {
  const navigate = useNavigate()
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

  // После подтверждения остаток уже списан — сравнение qty с текущим stock даёт ложную нехватку.
  const insufficient = editable
    ? document.lines.filter((line) => line.quantity > line.stockQuantity || !line.fifoPreview.enough)
    : []
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
            {document.confirmedAt ? ` подтверждена ${formatDate(document.confirmedAt)}` : ''}
          </span>
        </div>

        <SectionCard title="Данные">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,9rem)]">
            <div className="space-y-2">
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
                <p className="truncate text-sm">
                  {document.customerName || '—'}
                  {document.customerInn ? ` ИНН ${document.customerInn}` : ''}
                  {document.customerPhone ? ` ${document.customerPhone}` : ''}
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
          <div className="space-y-4">
            {editable ? <AddSaleLineForm saleId={document.id} /> : null}
            <SaleLinesTable document={document} editable={editable} />
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

function SaleLinesTable({ document, editable }: { document: SaleDocument; editable: boolean }) {
  const openSheet = useOpenEntitySheet()

  if (document.lines.length === 0) {
    return (
      <EmptyState
        title="Позиций нет"
        description="Найдите товар выше — он сразу попадёт в счёт."
        className="border-0 bg-transparent py-8"
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table className="table-fixed">
        <colgroup>
          <col style={{ width: '2rem' }} />
          <col />
          <col style={{ width: '5.5rem' }} />
          <col style={{ width: '5.75rem' }} />
          <col style={{ width: '5.5rem' }} />
          <col style={{ width: '2rem' }} />
        </colgroup>
        <TableHeader>
          <TableRow className="border-b hover:bg-transparent">
            <TableHead className={cn(cellPad, 'h-8')} aria-hidden />
            <TableHead className={cn(cellPad, 'h-8 text-xs font-medium text-muted-foreground')}>
              Наименование
            </TableHead>
            <TableHead className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}>
              Цена, ₽
            </TableHead>
            <TableHead
              className={cn(cellPad, 'h-8 pr-5 text-right text-xs font-medium text-muted-foreground')}
            >
              Кол-во
            </TableHead>
            <TableHead className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}>
              Сумма, ₽
            </TableHead>
            <TableHead className={cn(cellPad, 'h-8')} aria-hidden />
          </TableRow>
        </TableHeader>
        <TableBody>
          {document.lines.map((line) => (
            <SaleLineRow
              key={line.id}
              line={line}
              saleId={document.id}
              editable={editable}
              confirmed={document.status === SaleStatus.Confirmed}
              onOpen={() => openSheet('item', line.itemId)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SaleLineRow({
  line,
  saleId,
  editable,
  confirmed,
  onOpen,
}: {
  line: SaleLine
  saleId: string
  editable: boolean
  confirmed: boolean
  onOpen: () => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const remove = useRemoveSaleLine(saleId)
  const short =
    editable && (line.quantity > line.stockQuantity || !line.fifoPreview.enough)
  const meta = [line.itemCode, line.itemArticle].filter(Boolean).join(' ')
  const stockHint = editable ? `ост. ${formatQuantity(line.stockQuantity)} ${line.unitName}` : ''
  const subtitle = [meta, stockHint].filter(Boolean).join(' ')

  function handleRowClick(event: MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, button, a, [data-row-ignore-click]')) {
      return
    }
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      return
    }
    onOpen()
  }

  return (
    <TableRow
      className="group/row cursor-pointer border-b last:border-b-0 hover:bg-muted/20"
      onClick={handleRowClick}
    >
      <TableCell className={cn(cellPad, 'w-8 text-muted-foreground')}>
        <Briefcase className="size-3.5 opacity-70" aria-hidden />
        <span className="sr-only">Товар</span>
      </TableCell>
      <TableCell className={cn(cellPad, 'max-w-0 whitespace-normal')}>
        <div className="flex min-w-0 max-w-full items-baseline gap-2">
          <span className="cursor-text select-text truncate text-sm font-medium text-primary">
            {line.itemName}
          </span>
          {subtitle ? (
            <span
              className={cn(
                'hidden min-w-0 cursor-text select-text truncate text-[11px] sm:inline',
                short ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {subtitle}
            </span>
          ) : null}
        </div>
        {subtitle ? (
          <p
            className={cn(
              'mt-0.5 cursor-text select-text truncate text-[11px] sm:hidden',
              short ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {subtitle}
          </p>
        ) : null}
        <FifoHint line={line} confirmed={confirmed} />
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right')} data-row-ignore-click>
        <SaleInlineNumberField line={line} saleId={saleId} field="unitPrice" disabled={!editable} />
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right')} data-row-ignore-click>
        <SaleInlineNumberField
          line={line}
          saleId={saleId}
          field="quantity"
          disabled={!editable}
          suffix={line.unitName}
        />
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right text-sm tabular-nums')}>
        {formatMoney(line.amount)}
      </TableCell>
      <TableCell className={cellPad} data-row-ignore-click>
        {editable ? (
          <IconActionButton
            label="Удалить"
            variant="ghost"
            size="icon-xs"
            className="text-destructive opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100"
            disabled={remove.isPending}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
          </IconActionButton>
        ) : null}

        <ConfirmDialog
          open={deleteOpen}
          title="Удалить позицию"
          description={`«${line.itemName}» будет убрана из счёта.`}
          confirmLabel="Удалить"
          isPending={remove.isPending}
          onOpenChange={setDeleteOpen}
          onConfirm={() => {
            remove.mutate(line.id, {
              onSuccess: () => {
                setDeleteOpen(false)
                toast.success('Позиция удалена')
              },
              onError: (error) => toast.error(getErrorMessage(error)),
            })
          }}
        />
      </TableCell>
    </TableRow>
  )
}

function AddSaleLineForm({ saleId }: { saleId: string }) {
  const add = useAddSaleLine(saleId)
  const addInFlight = useRef(false)

  async function handleSelect(item: InventoryItem) {
    if (addInFlight.current) {
      return
    }
    addInFlight.current = true
    try {
      await add.mutateAsync({
        itemId: item.id,
        quantity: 1,
        unitPrice: item.retailPrice,
      })
      toast.success(`Добавлено: ${item.name}`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      addInFlight.current = false
    }
  }

  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium text-muted-foreground">Товар</Label>
      <ItemSearchField
        disabled={add.isPending}
        onSelect={(item) => void handleSelect(item)}
        searchPlaceholder="Наименование, штрихкод, код, артикул"
      />
    </div>
  )
}

function SaleInlineNumberField({
  line,
  saleId,
  field,
  disabled,
  suffix,
}: {
  line: SaleLine
  saleId: string
  field: 'quantity' | 'unitPrice'
  disabled: boolean
  suffix?: string
}) {
  const setLine = useSetSaleLine(saleId)
  const current = field === 'quantity' ? line.quantity : line.unitPrice
  const isQty = field === 'quantity'
  const stockCap = isQty
    ? Math.max(Math.round(line.stockQuantity), Math.round(line.quantity), 1)
    : null

  const [draft, setDraft] = useState(String(current))
  const [flash, setFlash] = useState(false)
  const draftRef = useRef(draft)
  const flashTimer = useRef<number | null>(null)
  draftRef.current = draft

  useEffect(() => {
    setDraft(String(current))
  }, [current, line.id])

  useEffect(() => {
    return () => {
      if (flashTimer.current != null) {
        window.clearTimeout(flashTimer.current)
      }
    }
  }, [])

  function flashCap() {
    setFlash(false)
    requestAnimationFrame(() => {
      setFlash(true)
      if (flashTimer.current != null) {
        window.clearTimeout(flashTimer.current)
      }
      flashTimer.current = window.setTimeout(() => setFlash(false), 550)
    })
  }

  function applyQuantity(raw: string, persist: boolean) {
    if (!persist && raw.trim() === '') {
      setDraft(raw)
      return
    }

    const parsed = parseQuantity(raw)
    if (parsed == null) {
      if (persist) {
        toast.error('Количество должно быть целым числом')
        setDraft(String(current))
      } else {
        setDraft(raw)
      }
      return
    }
    if (parsed <= 0) {
      if (persist) {
        toast.error('Количество должно быть больше нуля')
        setDraft(String(current))
      } else {
        setDraft(raw)
      }
      return
    }

    let next = parsed
    if (stockCap != null && next > stockCap) {
      next = stockCap
      setDraft(String(next))
      flashCap()
    } else {
      setDraft(String(next))
    }

    if (!persist || next === current) {
      return
    }

    setLine.mutate(
      { lineId: line.id, quantity: next, unitPrice: line.unitPrice },
      { onError: (error) => toast.error(getErrorMessage(error)) },
    )
  }

  function commitPrice(raw: string) {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed === current) {
      return
    }
    if (parsed < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }
    setLine.mutate(
      { lineId: line.id, quantity: line.quantity, unitPrice: parsed },
      { onError: (error) => toast.error(getErrorMessage(error)) },
    )
  }

  if (isQty) {
    return (
      <div className="inline-flex w-full items-center justify-end gap-1">
        {disabled ? (
          <span className="min-w-[2.25rem] text-right text-sm tabular-nums text-foreground">
            {formatQuantity(current)}
          </span>
        ) : (
          <Input
            type="number"
            min={1}
            max={stockCap ?? undefined}
            step="1"
            aria-label="Количество"
            className={cn(
              spinless,
              'h-7 w-[2.75rem] shrink-0 border-transparent bg-transparent px-0.5 text-right text-sm shadow-none tabular-nums',
              'hover:border-border hover:bg-background',
              'focus-visible:border-input focus-visible:bg-background focus-visible:ring-1',
              flash && 'animate-stock-cap',
            )}
            value={draft}
            disabled={setLine.isPending}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onFocus={(event) => event.target.select()}
            onChange={(event) => applyQuantity(event.target.value, false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            onBlur={() => applyQuantity(draftRef.current, true)}
          />
        )}
        <span className="w-8 shrink-0 text-left text-[11px] leading-none text-muted-foreground">
          {suffix || 'шт'}
        </span>
      </div>
    )
  }

  if (disabled) {
    return <span className="block text-right text-sm tabular-nums text-foreground">{formatMoney(current)}</span>
  }

  return (
    <Input
      key={`${line.id}-${field}-${current}`}
      type="number"
      min={0}
      step="0.01"
      aria-label="Цена"
      className={cn(
        spinless,
        'ml-auto h-7 w-[4.75rem] border-transparent bg-transparent px-1.5 text-right text-sm shadow-none tabular-nums',
        'hover:border-border hover:bg-background',
        'focus-visible:border-input focus-visible:bg-background focus-visible:ring-1',
      )}
      defaultValue={current}
      disabled={setLine.isPending}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
      onBlur={(event) => commitPrice(event.target.value)}
    />
  )
}

function fifoRowKey(row: SaleAllocation | SaleFifoPreviewLine) {
  if ('id' in row) {
    return row.id
  }
  return `${row.batchId}-${row.receiptDate}-${row.quantity}`
}

function FifoHint({ line, confirmed }: { line: SaleLine; confirmed: boolean }) {
  const rows = confirmed ? line.allocations : line.fifoPreview.lines
  if (rows.length === 0) {
    return null
  }

  return (
    <ul className="mt-0.5 hidden space-y-0.5 text-[11px] text-muted-foreground lg:block">
      {rows.map((row) => (
        <li key={fifoRowKey(row)}>
          партия {formatQuantity(row.quantity)}
          {row.receiptDate ? ` ${formatDate(row.receiptDate)}` : ''}
          {row.supplier ? ` ${row.supplier}` : ''}
        </li>
      ))}
    </ul>
  )
}
