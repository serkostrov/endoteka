import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Briefcase, Trash2 } from 'lucide-react'

import { DatePicker } from '@/components/shared/DatePicker'
import { EmptyState } from '@/components/shared/EmptyState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  runSheetFormSave,
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
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { toIsoDate } from '@/lib/utils/date'

import { CreateItemDialog } from './CreateItemDialog'
import { InventoryItemSheet } from './InventoryItemScreen'
import { ItemSearchField } from './ItemSearchField'
import { useReceiveInventory } from '../hooks/use-inventory'
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
}

const cellPad = 'px-2 py-1.5'
const spinless =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

export function ReceiveStockSheet({ open, onOpenChange, presetSupplier }: ReceiveStockSheetProps) {
  const receive = useReceiveInventory()
  const [lines, setLines] = useState<DraftLine[]>([])
  const [supplierId, setSupplierId] = useState(presetSupplier?.id ?? '')
  const [createItemOpen, setCreateItemOpen] = useState(false)
  const [createQuery, setCreateQuery] = useState('')
  const [openedItemId, setOpenedItemId] = useState<string | null>(null)
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

  useEffect(() => {
    if (!open) {
      return
    }
    setLines([])
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
  }, [open, form, presetSupplier?.id, presetSupplier?.name])

  function addLine(item: InventoryItem, quantity = 1, purchasePrice = item.purchasePrice) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error('Количество должно быть больше нуля')
      return
    }
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }
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
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
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
      lines: lines.map((line) => ({
        itemId: line.item.id,
        quantity: line.quantity,
        purchasePrice: line.purchasePrice,
      })),
    })
    toast.success('Приход проведён')
  }

  async function onSubmit(values: ReceiveFormValues) {
    try {
      await persist(values)
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <>
      <Sheet
        open={open}
        dirty={form.formState.isDirty || lines.length > 0}
        onSave={() => runSheetFormSave(form.handleSubmit, persist)}
        onOpenChange={onOpenChange}
      >
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Новый приход</SheetTitle>
            <SheetDescription>
              Сначала документ, затем товары. Проведение создаёт партии и журнал одной транзакцией.
            </SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form className="flex flex-1 flex-col gap-4 px-4 pb-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <div className="space-y-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Документ</p>
                  <p className="text-xs text-muted-foreground">Поставщик из контактов, дата и комментарий.</p>
                </div>
                <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
                  <FormField
                    control={form.control}
                    name="supplier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Поставщик</FormLabel>
                        {lockedSupplier ? (
                          <div className="flex h-9 items-center rounded-md border bg-background px-3 text-sm font-medium shadow-xs">
                            {field.value}
                          </div>
                        ) : (
                          <CustomerPicker
                            compact
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
                        <FormLabel>Дата</FormLabel>
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
                          className="field-sizing-content min-h-9 max-h-32 resize-none overflow-y-auto py-1.5 leading-5"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Товары в приходе</p>
                  <p className="text-xs text-muted-foreground">
                    Выберите позицию — она появится в списке. Количество и цену можно изменить в строке.
                  </p>
                </div>
                <ItemSearchField
                  onSelect={(item) => addLine(item)}
                  allowCreate
                  onCreateRequest={(query) => {
                    setCreateQuery(query)
                    setCreateItemOpen(true)
                  }}
                />
                {lines.length === 0 ? (
                  <EmptyState
                    title="Строк пока нет"
                    description="Нажмите на поле поиска и выберите позицию."
                    className="border-0 bg-transparent py-8"
                  />
                ) : (
                  <>
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
                              onRemove={() =>
                                setLines((current) => current.filter((item) => item.key !== line.key))
                              }
                              onOpenItem={setOpenedItemId}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-right text-sm">
                      <span className="text-muted-foreground">Итого </span>
                      <span className="font-semibold tabular-nums">{formatMoney(documentTotal)}</span>
                    </p>
                  </>
                )}
              </div>

              <SheetFooter className="px-0">
                <SheetClose asChild>
                  <Button type="button" variant="outline">
                    Отмена
                  </Button>
                </SheetClose>
                <Button type="submit" disabled={receive.isPending}>
                  {receive.isPending ? 'Проведение…' : 'Провести приход'}
                </Button>
              </SheetFooter>
            </form>
          </Form>
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
  const meta = [line.item.code, line.item.article].filter(Boolean).join(' · ')
  const unit = line.item.unitName || 'шт'

  function commitQuantity(raw: string) {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed === line.quantity) {
      return
    }
    if (parsed <= 0) {
      toast.error('Количество должно быть больше нуля')
      return
    }
    onChange({ quantity: parsed })
  }

  function commitPrice(raw: string) {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed === line.purchasePrice) {
      return
    }
    if (parsed < 0) {
      toast.error('Цена не может быть отрицательной')
      return
    }
    onChange({ purchasePrice: parsed })
  }

  return (
    <TableRow className="group/row border-b last:border-b-0 hover:bg-muted/20">
      <TableCell className={cn(cellPad, 'w-8 text-muted-foreground')}>
        <Briefcase className="size-3.5 opacity-70" aria-hidden />
        <span className="sr-only">Товар</span>
      </TableCell>
      <TableCell className={cn(cellPad, 'max-w-0 whitespace-normal')}>
        <button
          type="button"
          className="flex min-w-0 max-w-full items-baseline gap-2 text-left text-primary underline-offset-2 hover:underline"
          onClick={() => onOpenItem(line.item.id)}
        >
          <span className="truncate text-sm font-medium">{line.item.name}</span>
          {meta ? (
            <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:inline">{meta}</span>
          ) : null}
        </button>
        {meta ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground sm:hidden">{meta}</p> : null}
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Остаток: {formatQuantity(line.item.stockQuantity)} {unit}
        </p>
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right')}>
        <Input
          key={`${line.key}-price-${line.purchasePrice}`}
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
          defaultValue={line.purchasePrice}
          onFocus={(event) => event.target.select()}
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
            min={0.001}
            step="0.001"
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
          className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 />
        </IconActionButton>
      </TableCell>
    </TableRow>
  )
}
