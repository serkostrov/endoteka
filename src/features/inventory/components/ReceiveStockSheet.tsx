import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { DatePicker } from '@/components/shared/DatePicker'
import { EmptyState } from '@/components/shared/EmptyState'
import { IconActionButton } from '@/components/shared/IconActionButton'
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
  runSheetFormSave,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { CustomerPicker } from '@/features/customers/components/CustomerPicker'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
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
                    className="py-8"
                  />
                ) : (
                  <ul className="grid gap-1.5">
                    {lines.map((line) => (
                      <li key={line.key}>
                        <ReceiptDraftCard
                          line={line}
                          onChange={(patch) => updateLine(line.key, patch)}
                          onRemove={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                          onOpenItem={setOpenedItemId}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {lines.length > 0 ? (
                  <p className="text-right text-sm">
                    <span className="text-muted-foreground">Итого </span>
                    <span className="font-semibold tabular-nums">{formatMoney(documentTotal)} ₽</span>
                  </p>
                ) : null}
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

function ReceiptDraftCard({
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
  const qtyId = `${line.key}-qty`
  const priceId = `${line.key}-price`

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
    <article
      className="group cursor-pointer rounded-lg border bg-card px-2.5 py-2 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/50"
      onClick={() => onOpenItem(line.item.id)}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="min-w-0 truncate text-sm font-medium text-primary underline-offset-2 group-hover:underline">
              {line.item.name}
            </p>
            {meta ? <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{meta}</span> : null}
          </div>
          {meta ? <p className="truncate text-xs text-muted-foreground sm:hidden">{meta}</p> : null}
        </div>
        <IconActionButton
          label="Убрать"
          variant="ghost"
          size="icon-xs"
          className="-mt-0.5 -mr-1 shrink-0 text-destructive hover:text-destructive"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <Trash2 />
        </IconActionButton>
      </div>

      <div
        className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="space-y-0.5">
          <Label htmlFor={qtyId} className="text-[11px] font-normal leading-none text-muted-foreground">
            Кол-во
          </Label>
          <div className="flex items-center gap-1">
            <Input
              id={qtyId}
              key={`${line.key}-qty-${line.quantity}`}
              type="number"
              min={0.001}
              step="0.001"
              className="h-7 w-[4.75rem] px-2 tabular-nums"
              defaultValue={line.quantity}
              onBlur={(event) => commitQuantity(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">{unit}</span>
          </div>
        </div>
        <div className="space-y-0.5">
          <Label htmlFor={priceId} className="text-[11px] font-normal leading-none text-muted-foreground">
            Цена
          </Label>
          <div className="flex items-center gap-1">
            <Input
              id={priceId}
              key={`${line.key}-price-${line.purchasePrice}`}
              type="number"
              min={0}
              step="0.01"
              className="h-7 w-[4.75rem] px-2 tabular-nums"
              defaultValue={line.purchasePrice}
              onBlur={(event) => commitPrice(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">₽</span>
          </div>
        </div>
        <div className="min-w-16 space-y-0.5">
          <p className="text-[11px] leading-none text-muted-foreground">Сумма</p>
          <p className="flex h-7 items-center text-sm font-medium tabular-nums">{formatMoney(amount)} ₽</p>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        Остаток: {formatQuantity(line.item.stockQuantity)} {unit}
      </p>
    </article>
  )
}
