import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { DatePicker } from '@/components/shared/DatePicker'
import { EmptyState } from '@/components/shared/EmptyState'
import { IconActionButton } from '@/components/shared/IconActionButton'
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
import { formatMoney, formatQuantity, parseQuantity } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { toIsoDate } from '@/lib/utils/date'

import { InventoryItemCoverThumb } from './InventoryItemCoverThumb'
import { InventoryItemSheet } from './InventoryItemScreen'
import { ItemSearchField } from './ItemSearchField'
import { useCreateInventoryWriteOff } from '../hooks/use-inventory'
import { writeOffFormSchema, type WriteOffFormValues } from '../schemas'
import type { InventoryItem } from '../services/inventory-service'

type DraftLine = {
  key: string
  item: InventoryItem
  quantity: number
}

type WriteOffStockSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const cellPad = 'px-2 py-1.5'
const spinless =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

export function WriteOffStockSheet({ open, onOpenChange }: WriteOffStockSheetProps) {
  const create = useCreateInventoryWriteOff()
  const [lines, setLines] = useState<DraftLine[]>([])
  const [openedItemId, setOpenedItemId] = useState<string | null>(null)
  const form = useForm<WriteOffFormValues>({
    resolver: zodResolver(writeOffFormSchema),
    defaultValues: {
      writeOffDate: toIsoDate(new Date()),
      reason: '',
      notes: '',
    },
  })
  const documentTotal = lines.reduce((sum, line) => sum + line.quantity * line.item.purchasePrice, 0)
  const insufficient = lines.filter((line) => line.quantity > line.item.stockQuantity)

  useEffect(() => {
    if (!open) {
      return
    }
    setLines([])
    form.reset({
      writeOffDate: toIsoDate(new Date()),
      reason: '',
      notes: '',
    })
  }, [open, form])

  function addLine(item: InventoryItem, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      toast.error('Количество должно быть целым числом больше нуля')
      return
    }
    if (item.stockQuantity <= 0) {
      toast.error(`Нет остатка: ${item.name}`)
      return
    }
    setLines((current) => {
      const existing = current.find((line) => line.item.id === item.id)
      if (existing) {
        const nextQty = existing.quantity + quantity
        if (nextQty > item.stockQuantity) {
          toast.error(
            `Недостаточно остатка. Доступно ${formatQuantity(item.stockQuantity)} ${item.unitName || 'шт'}`,
          )
          return current
        }
        return current.map((line) =>
          line.key === existing.key ? { ...line, quantity: nextQty } : line,
        )
      }
      return [...current, { key: `${item.id}-${Date.now()}`, item, quantity }]
    })
    toast.success(`Добавлено: ${item.name}`)
  }

  function updateLine(key: string, quantity: number) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, quantity } : line)))
  }

  async function persist(values: WriteOffFormValues) {
    if (lines.length === 0) {
      throw new Error('Добавьте хотя бы одну позицию')
    }
    if (lines.some((line) => line.quantity <= 0)) {
      throw new Error('Проверьте количество в строках')
    }
    if (lines.some((line) => line.quantity > line.item.stockQuantity)) {
      throw new Error('Недостаточно остатка по одной или нескольким позициям')
    }
    await create.mutateAsync({
      writeOffDate: values.writeOffDate,
      reason: values.reason,
      notes: values.notes,
      lines: lines.map((line) => ({
        itemId: line.item.id,
        quantity: line.quantity,
      })),
    })
    toast.success('Списание проведено, товар убран со склада')
  }

  async function onSubmit(values: WriteOffFormValues) {
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
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,56rem)]"
        >
          <SheetHeader className="shrink-0 border-b px-4 py-3 pr-14">
            <SheetTitle>Новое списание</SheetTitle>
            <SheetDescription>
              Списание уменьшает остаток по FIFO: сначала самые ранние партии.
            </SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={form.handleSubmit(onSubmit)}
              noValidate
            >
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                <SectionCard title="Документ" description="Дата и причина списания.">
                  <div className="space-y-3">
                    <div className="grid items-start gap-3 sm:grid-cols-[10.5rem_minmax(0,1fr)]">
                      <FormField
                        control={form.control}
                        name="writeOffDate"
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
                      <FormField
                        control={form.control}
                        name="reason"
                        render={({ field }) => (
                          <FormItem className="min-w-0">
                            <FormLabel className="mb-0 flex h-5 items-center">Причина</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Брак, порча, использование…" autoComplete="off" />
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
                        searchPlaceholder="Наименование, штрихкод, код, артикул"
                      />
                    </div>

                    {insufficient.length > 0 ? (
                      <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        Недостаточно остатка:{' '}
                        {insufficient
                          .map(
                            (line) =>
                              `${line.item.name} (нужно ${formatQuantity(line.quantity)}, доступно ${formatQuantity(line.item.stockQuantity)})`,
                          )
                          .join('; ')}
                        .
                      </p>
                    ) : null}

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
                              <WriteOffDraftRow
                                key={line.key}
                                line={line}
                                onChange={(quantity) => updateLine(line.key, quantity)}
                                onRemove={() =>
                                  setLines((current) => current.filter((item) => item.key !== line.key))
                                }
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
                <div className="flex w-full gap-2 sm:w-auto">
                  <SheetClose asChild>
                    <Button type="button" variant="outline" className="flex-1 sm:flex-none">
                      Отмена
                    </Button>
                  </SheetClose>
                  <Button
                    type="submit"
                    disabled={create.isPending || lines.length === 0 || insufficient.length > 0}
                    className="flex-1 sm:flex-none"
                  >
                    {create.isPending ? 'Проведение…' : 'Провести списание'}
                  </Button>
                </div>
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
    </>
  )
}

function WriteOffDraftRow({
  line,
  onChange,
  onRemove,
  onOpenItem,
}: {
  line: DraftLine
  onChange: (quantity: number) => void
  onRemove: () => void
  onOpenItem: (itemId: string) => void
}) {
  const amount = line.quantity * line.item.purchasePrice
  const unit = line.item.unitName || 'шт'
  const meta = [line.item.code, line.item.article].filter(Boolean).join(' ')
  const stockCap = Math.max(1, Math.round(line.item.stockQuantity))
  const short = line.quantity > stockCap
  const subtitle = [meta, `ост. ${formatQuantity(line.item.stockQuantity)} ${unit}`]
    .filter(Boolean)
    .join(' ')

  const [draft, setDraft] = useState(String(line.quantity))
  const [flash, setFlash] = useState(false)
  const draftRef = useRef(draft)
  const flashTimer = useRef<number | null>(null)
  draftRef.current = draft

  useEffect(() => {
    setDraft(String(line.quantity))
  }, [line.quantity, line.key])

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
        setDraft(String(line.quantity))
      } else {
        setDraft(raw)
      }
      return
    }
    if (parsed <= 0) {
      if (persist) {
        toast.error('Количество должно быть больше нуля')
        setDraft(String(line.quantity))
      } else {
        setDraft(raw)
      }
      return
    }

    let next = parsed
    if (next > stockCap) {
      next = stockCap
      setDraft(String(next))
      flashCap()
    } else {
      setDraft(String(next))
    }

    if (!persist || next === line.quantity) {
      return
    }
    onChange(next)
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
            <span
              className={cn(
                'w-full truncate text-[11px]',
                short ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {subtitle}
            </span>
          ) : null}
        </button>
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right text-sm tabular-nums')}>
        {formatMoney(line.item.purchasePrice)}
      </TableCell>
      <TableCell className={cn(cellPad, 'text-right')}>
        <div className="inline-flex w-full items-center justify-end gap-1">
          <Input
            type="number"
            min={1}
            max={stockCap}
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
            onFocus={(event) => event.target.select()}
            onChange={(event) => applyQuantity(event.target.value, false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            onBlur={() => applyQuantity(draftRef.current, true)}
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
