import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { DatePicker } from '@/components/shared/DatePicker'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { CustomerPicker } from '@/features/customers/components/CustomerPicker'
import { formatMoney, formatQuantity, parseMoney, parseQuantity } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { toIsoDate } from '@/lib/utils/date'

import { CreateItemDialog } from './CreateItemDialog'
import { InventoryItemCoverThumb } from './InventoryItemCoverThumb'
import { InventoryItemSheet } from './InventoryItemScreen'
import { ItemSearchField } from './ItemSearchField'
import {
  useInventoryReceipt,
  useReceiveInventory,
  useSaveInventoryReceiptDraft,
} from '../hooks/use-inventory'
import { receiveFormSchema, type ReceiveFormValues } from '../schemas'
import type { InventoryItem } from '../services/inventory-service'

type DraftLine = {
  key: string
  item: InventoryItem
  quantity: number
  purchasePrice: number
}

export type ReceiptSupplierPreset = {
  id: string
  name: string
}

type ReceiveStockSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  presetSupplier?: ReceiptSupplierPreset
  /** Редактирование существующего черновика. */
  draftId?: string | null
}

const cellPad = 'px-2 py-1.5'
const spinless =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

export function ReceiveStockSheet({
  open,
  onOpenChange,
  presetSupplier,
  draftId = null,
}: ReceiveStockSheetProps) {
  const receive = useReceiveInventory()
  const saveDraft = useSaveInventoryReceiptDraft()
  const draftQuery = useInventoryReceipt(draftId ?? undefined)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(draftId)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [supplierId, setSupplierId] = useState(presetSupplier?.id ?? '')
  const [createItemOpen, setCreateItemOpen] = useState(false)
  const [createQuery, setCreateQuery] = useState('')
  const [openedItemId, setOpenedItemId] = useState<string | null>(null)
  const [hydratedDraftId, setHydratedDraftId] = useState<string | null>(null)
  const [linesTouched, setLinesTouched] = useState(false)
  const form = useForm<ReceiveFormValues>({
    resolver: zodResolver(receiveFormSchema),
    defaultValues: {
      supplier: presetSupplier?.name ?? '',
      receiptDate: toIsoDate(new Date()),
      notes: '',
    },
  })
  const documentTotal = lines.reduce((sum, line) => sum + line.quantity * line.purchasePrice, 0)
  const lockedSupplier = Boolean(presetSupplier)
  const pending = receive.isPending || saveDraft.isPending
  const isEditingDraft = Boolean(activeDraftId)
  const dirty = form.formState.isDirty || linesTouched
  const draftLoading = Boolean(draftId) && draftQuery.isLoading && hydratedDraftId !== draftId
  const draftError = Boolean(draftId) && draftQuery.error && hydratedDraftId !== draftId

  useEffect(() => {
    if (!open) {
      setHydratedDraftId(null)
      setActiveDraftId(draftId)
      setLinesTouched(false)
      return
    }
    setActiveDraftId(draftId)
    if (draftId) {
      return
    }
    setLines([])
    setHydratedDraftId(null)
    setLinesTouched(false)
    if (presetSupplier) {
      setSupplierId(presetSupplier.id)
      form.reset({
        supplier: presetSupplier.name,
        receiptDate: toIsoDate(new Date()),
        notes: '',
      })
      return
    }
    setSupplierId('')
    form.reset({
      supplier: '',
      receiptDate: toIsoDate(new Date()),
      notes: '',
    })
  }, [open, form, presetSupplier?.id, presetSupplier?.name, draftId])

  useEffect(() => {
    if (!open || !draftId || !draftQuery.data || draftQuery.data.status !== 'draft') {
      return
    }
    if (hydratedDraftId === draftId) {
      return
    }
    const receipt = draftQuery.data
    setActiveDraftId(receipt.id)
    setSupplierId(receipt.supplierId ?? '')
    form.reset({
      supplier: receipt.supplier,
      receiptDate: receipt.receiptDate || toIsoDate(new Date()),
      notes: receipt.notes,
    })
    setLines(
      receipt.lines.flatMap((line) => {
        if (!line.item) {
          return []
        }
        return [
          {
            key: `${line.item.id}-${line.unitPrice}-${line.id}`,
            item: line.item,
            quantity: line.quantity,
            purchasePrice: line.unitPrice,
          },
        ]
      }),
    )
    setLinesTouched(false)
    setHydratedDraftId(draftId)
  }, [open, draftId, draftQuery.data, form, hydratedDraftId])

  function addLine(item: InventoryItem, quantity = 1, purchasePrice = item.purchasePrice) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      toast.error('Количество должно быть целым числом больше нуля')
      return
    }
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }
    setLinesTouched(true)
    setLines((current) => {
      const existing = current.find((line) => line.item.id === item.id && line.purchasePrice === purchasePrice)
      if (existing) {
        return current.map((line) =>
          line.key === existing.key ? { ...line, quantity: line.quantity + quantity } : line,
        )
      }
      return [
        ...current,
        { key: `${item.id}-${purchasePrice}-${Date.now()}`, item, quantity, purchasePrice },
      ]
    })
    toast.success(`Добавлено: ${item.name}`)
  }

  function updateLine(key: string, patch: Partial<Pick<DraftLine, 'quantity' | 'purchasePrice'>>) {
    setLinesTouched(true)
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function linePayload() {
    return lines.map((line) => ({
      itemId: line.item.id,
      quantity: line.quantity,
      purchasePrice: line.purchasePrice,
    }))
  }

  async function persist(values: ReceiveFormValues) {
    if (lines.length === 0) {
      throw new Error('Добавьте хотя бы одну позицию')
    }
    if (lines.some((line) => line.quantity <= 0 || line.purchasePrice < 0)) {
      throw new Error('Проверьте количество и цену в строках')
    }
    await receive.mutateAsync({
      supplier: values.supplier,
      supplierId: supplierId || null,
      receiptDate: values.receiptDate,
      notes: values.notes,
      lines: linePayload(),
      draftId: activeDraftId,
    })
    toast.success('Приход проведён, товар добавлен на склад')
  }

  async function persistDraft(values: ReceiveFormValues) {
    if (lines.some((line) => line.quantity <= 0 || line.purchasePrice < 0)) {
      throw new Error('Проверьте количество и цену в строках')
    }
    const id = await saveDraft.mutateAsync({
      draftId: activeDraftId,
      supplier: values.supplier,
      supplierId: supplierId || null,
      receiptDate: values.receiptDate || toIsoDate(new Date()),
      notes: values.notes,
      lines: linePayload(),
    })
    setActiveDraftId(id)
    toast.success('Черновик сохранён')
  }

  async function onSubmit(values: ReceiveFormValues) {
    try {
      await persist(values)
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function onSaveDraft() {
    const values = form.getValues()
    if (!values.receiptDate) {
      form.setError('receiptDate', { message: 'Укажите дату' })
      return
    }
    try {
      await persistDraft(values)
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <>
      <Sheet
        open={open}
        dirty={dirty}
        onSave={async () => {
          await persistDraft(form.getValues())
        }}
        onOpenChange={onOpenChange}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,56rem)]"
        >
          <SheetHeader className="shrink-0 border-b px-4 py-3 pr-14">
            <SheetTitle>{isEditingDraft ? 'Черновик прихода' : 'Новый приход'}</SheetTitle>
            <SheetDescription>
              {isEditingDraft
                ? 'Можно продолжить заполнение или провести документ.'
                : 'Документ и строки. Проведение создаёт партии и журнал одной транзакцией.'}
            </SheetDescription>
          </SheetHeader>
          {draftLoading ? (
            <LoadingState label="Загрузка черновика" className="min-h-40 flex-1" />
          ) : draftError ? (
            <ErrorState description={getErrorMessage(draftQuery.error)} className="flex-1" />
          ) : (
          <Form {...form}>
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={form.handleSubmit(onSubmit)}
              noValidate
            >
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                <SectionCard
                  title="Документ"
                  description="Поставщик, дата и комментарий."
                >
                  <div className="space-y-3">
                    <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
                      <FormField
                        control={form.control}
                        name="supplier"
                        render={({ field }) => (
                          <FormItem className="min-w-0">
                            <div className="flex h-5 items-center justify-between gap-2">
                              <FormLabel className="mb-0">Поставщик</FormLabel>
                              {supplierId && !lockedSupplier ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setSupplierId('')
                                    field.onChange('')
                                  }}
                                >
                                  Сменить
                                </Button>
                              ) : null}
                            </div>
                            {lockedSupplier ? (
                              <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm font-medium">
                                <span className="truncate">{field.value}</span>
                              </div>
                            ) : (
                              <CustomerPicker
                                compact
                                hideChangeButton
                                value={supplierId}
                                searchLabel="Поиск поставщика"
                                placeholder="Название, ИНН или телефон"
                                emptyMessage="Контакты не найдены"
                                createTitle="Новый контакт"
                                createDescription="Поставщик сохранится в справочнике контактов."
                                onChange={(customer) => {
                                  setSupplierId(customer?.id ?? '')
                                  field.onChange(customer?.name ?? '')
                                }}
                              />
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="receiptDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="mb-0 flex h-5 items-center">Дата</FormLabel>
                            <FormControl>
                              <DatePicker value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Комментарий</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              rows={1}
                              placeholder="Необязательно"
                              className="field-sizing-content min-h-9 max-h-28 resize-none overflow-y-auto py-1.5 leading-5"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  title="Товары"
                  actions={
                    <p className="text-sm tabular-nums">
                      <span className="text-muted-foreground">Итого </span>
                      <span className="font-semibold">{formatMoney(documentTotal)} ₽</span>
                    </p>
                  }
                >
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-muted-foreground">Товар</Label>
                      <ItemSearchField
                        onSelect={(item) => addLine(item)}
                        allowCreate
                        searchPlaceholder="Наименование, штрихкод, код, артикул"
                        onCreateRequest={(query) => {
                          setCreateQuery(query)
                          setCreateItemOpen(true)
                        }}
                      />
                    </div>
                    {lines.length === 0 ? (
                      <EmptyState
                        title="Позиций нет"
                        description="Найдите товар выше — он сразу попадёт в список."
                        className="border-0 bg-transparent py-8"
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table className="table-fixed">
                          <colgroup>
                            <col style={{ width: '2.75rem' }} />
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
                              <TableHead
                                className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}
                              >
                                Цена, ₽
                              </TableHead>
                              <TableHead
                                className={cn(
                                  cellPad,
                                  'h-8 pr-5 text-right text-xs font-medium text-muted-foreground',
                                )}
                              >
                                Кол-во
                              </TableHead>
                              <TableHead
                                className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}
                              >
                                Сумма, ₽
                              </TableHead>
                              <TableHead className={cn(cellPad, 'h-8')} aria-hidden />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lines.map((line) => (
                              <ReceiptDraftRow
                                key={line.key}
                                line={line}
                                onChange={(patch) => updateLine(line.key, patch)}
                                onRemove={() => {
                                  setLinesTouched(true)
                                  setLines((current) => current.filter((item) => item.key !== line.key))
                                }}
                                onOpenItem={setOpenedItemId}
                              />
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </SectionCard>
              </div>

              <SheetFooter className="shrink-0 border-t bg-background px-4 py-3 sm:justify-between">
                <p className="hidden text-sm tabular-nums sm:block">
                  {lines.length > 0 ? (
                    <>
                      <span className="text-muted-foreground">Позиций {lines.length} </span>
                      <span className="font-semibold">{formatMoney(documentTotal)} ₽</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Добавьте товары для проведения</span>
                  )}
                </p>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
                  <SheetClose asChild>
                    <Button type="button" variant="outline" className="flex-1 sm:flex-none" disabled={pending}>
                      Отмена
                    </Button>
                  </SheetClose>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    disabled={pending}
                    onClick={() => void onSaveDraft()}
                  >
                    {saveDraft.isPending ? 'Сохранение…' : 'Сохранить как черновик'}
                  </Button>
                  <Button type="submit" disabled={pending || lines.length === 0} className="flex-1 sm:flex-none">
                    {receive.isPending ? 'Проведение…' : 'Оприходовать'}
                  </Button>
                </div>
              </SheetFooter>
            </form>
          </Form>
          )}
        </SheetContent>
      </Sheet>
      <InventoryItemSheet
        itemId={openedItemId}
        open={Boolean(openedItemId)}
        onOpenChange={(next) => {
          if (!next) {
            setOpenedItemId(null)
          }
        }}
      />
      <CreateItemDialog
        open={createItemOpen}
        onOpenChange={setCreateItemOpen}
        initialQuery={createQuery}
        onCreated={(item) => addLine(item)}
      />
    </>
  )
}

function ReceiptDraftRow({
  line,
  onChange,
  onRemove,
  onOpenItem,
}: {
  line: DraftLine
  onChange: (patch: Partial<Pick<DraftLine, 'quantity' | 'purchasePrice'>>) => void
  onRemove: () => void
  onOpenItem: (itemId: string) => void
}) {
  const amount = line.quantity * line.purchasePrice
  const meta = [line.item.code, line.item.article].filter(Boolean).join(' ')
  const unit = line.item.unitName || 'шт'
  const subtitle = [meta, `ост. ${formatQuantity(line.item.stockQuantity)} ${unit}`].filter(Boolean).join(' ')
  const [priceEditKey, setPriceEditKey] = useState(0)

  function commitQuantity(raw: string) {
    const parsed = parseQuantity(raw)
    if (parsed == null) {
      toast.error('Количество должно быть целым числом')
      return
    }
    if (parsed === line.quantity) {
      return
    }
    if (parsed <= 0) {
      toast.error('Количество должно быть больше нуля')
      return
    }
    onChange({ quantity: parsed })
  }

  function commitPrice(raw: string) {
    const parsed = parseMoney(raw)
    if (parsed == null) {
      toast.error('Некорректная цена')
      setPriceEditKey((key) => key + 1)
      return
    }
    if (parsed < 0) {
      toast.error('Цена не может быть отрицательной')
      setPriceEditKey((key) => key + 1)
      return
    }
    if (parsed === line.purchasePrice) {
      setPriceEditKey((key) => key + 1)
      return
    }
    onChange({ purchasePrice: parsed })
  }

  return (
    <TableRow className="group/row border-b last:border-b-0 hover:bg-muted/20">
      <TableCell className={cn(cellPad, 'w-11')}>
        <InventoryItemCoverThumb src={line.item.coverUrl} alt={line.item.name} className="size-8" />
      </TableCell>
      <TableCell className={cn(cellPad, 'max-w-0 whitespace-normal')}>
        <button
          type="button"
          className="flex min-w-0 max-w-full flex-col items-start gap-0.5 text-left"
          onClick={() => onOpenItem(line.item.id)}
        >
          <span className="w-full truncate text-sm font-medium text-primary underline-offset-2 hover:underline">
            {line.item.name}
          </span>
          {subtitle ? (
            <span className="w-full truncate text-[11px] text-muted-foreground">{subtitle}</span>
          ) : null}
        </button>
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right')}>
        <Input
          key={`${line.key}-price-${line.purchasePrice}-${priceEditKey}`}
          type="text"
          inputMode="decimal"
          aria-label="Цена"
          className={cn(
            spinless,
            'ml-auto h-7 w-[4.75rem] border-transparent bg-transparent px-1.5 text-right text-sm shadow-none tabular-nums',
            'hover:border-border hover:bg-background',
            'focus-visible:border-input focus-visible:bg-background focus-visible:ring-1',
          )}
          defaultValue={formatMoney(line.purchasePrice)}
          onFocus={(event) => {
            event.target.value = String(line.purchasePrice)
            event.target.select()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
          onBlur={(event) => commitPrice(event.target.value)}
        />
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right')}>
        <div className="inline-flex w-full items-center justify-end gap-1">
          <Input
            key={`${line.key}-qty-${line.quantity}`}
            type="number"
            min={1}
            step="1"
            aria-label="Количество"
            className={cn(
              spinless,
              'h-7 w-[2.75rem] shrink-0 border-transparent bg-transparent px-0.5 text-right text-sm shadow-none tabular-nums',
              'hover:border-border hover:bg-background',
              'focus-visible:border-input focus-visible:bg-background focus-visible:ring-1',
            )}
            defaultValue={line.quantity}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            onBlur={(event) => commitQuantity(event.target.value)}
          />
          <span className="w-8 shrink-0 text-left text-[11px] leading-none text-muted-foreground">{unit}</span>
        </div>
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right text-sm tabular-nums')}>{formatMoney(amount)}</TableCell>
      <TableCell className={cellPad}>
        <IconActionButton
          label="Убрать"
          variant="ghost"
          size="icon-xs"
          className="text-destructive opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100"
          onClick={onRemove}
        >
          <Trash2 />
        </IconActionButton>
      </TableCell>
    </TableRow>
  )
}
