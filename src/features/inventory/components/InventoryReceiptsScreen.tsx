import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { DatePicker } from '@/components/shared/DatePicker'
import { DataTable } from '@/components/shared/DataTable'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useHasPermission } from '@/features/auth'
import { INVENTORY_PAGE_SIZE, formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatDate, formatDateTime, toIsoDate } from '@/lib/utils/date'

import { CreateItemDialog } from './CreateItemDialog'
import { ItemSearchField } from './ItemSearchField'
import { useInventoryReceipt, useInventoryReceipts, useReceiveInventory } from '../hooks/use-inventory'
import { receiveFormSchema, type ReceiveFormValues } from '../schemas'
import type { InventoryItem } from '../services/inventory-service'

type DraftLine = {
  key: string
  item: InventoryItem
  quantity: number
  purchasePrice: number
}

export function InventoryReceiptsScreen() {
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const receiptsQuery = useInventoryReceipts(page, INVENTORY_PAGE_SIZE)
  const receiptQuery = useInventoryReceipt(selectedId)
  const total = receiptsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Приходы"
        description="Каждый приход создаёт партии. Остаток считается по журналу, не по ручному полю."
        actions={
          canReceive ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый приход
            </Button>
          ) : null
        }
      />

      <DataTable
        caption="Приходы"
        isLoading={receiptsQuery.isLoading}
        error={receiptsQuery.error ? getErrorMessage(receiptsQuery.error) : null}
        data={receiptsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Приходов нет"
        emptyDescription="Оформите поступление, чтобы появились партии."
        onRowClick={(row) => setSelectedId(row.id)}
        pagination={{ page, pageCount, onPageChange: setPage }}
        columns={[
          { id: 'date', header: 'Дата', cell: (row) => formatDate(row.receiptDate) },
          { id: 'supplier', header: 'Поставщик', cell: (row) => row.supplier },
          { id: 'lines', header: 'Строк', cell: (row) => String(row.lineCount) },
          { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(row.totalQuantity) },
          {
            id: 'actor',
            header: 'Кто',
            className: 'hidden md:table-cell',
            cell: (row) => row.actorName || '—',
          },
          {
            id: 'created',
            header: 'Создан',
            className: 'hidden lg:table-cell',
            cell: (row) => formatDateTime(row.createdAt),
          },
        ]}
      />

      {selectedId && receiptQuery.data ? (
        <SectionCard
          title={`Приход · ${receiptQuery.data.supplier}`}
          description={`${formatDate(receiptQuery.data.receiptDate)}${receiptQuery.data.notes ? ` · ${receiptQuery.data.notes}` : ''}`}
          actions={
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(undefined)}>
              Скрыть
            </Button>
          }
        >
          <DataTable
            caption="Строки прихода"
            data={receiptQuery.data.lines}
            getRowId={(row) => row.id}
            emptyTitle="Строк нет"
            columns={[
              { id: 'name', header: 'Позиция', cell: (row) => row.itemName },
              { id: 'code', header: 'Код', cell: (row) => row.itemCode },
              { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(row.quantity) },
              { id: 'price', header: 'Цена', cell: (row) => formatMoney(row.unitPrice) },
              { id: 'left', header: 'Остаток партии', cell: (row) => formatQuantity(row.remainingQuantity) },
            ]}
          />
        </SectionCard>
      ) : null}

      <ReceiveStockSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function ReceiveStockSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const receive = useReceiveInventory()
  const [lines, setLines] = useState<DraftLine[]>([])
  const [picking, setPicking] = useState<InventoryItem | null>(null)
  const [createItemOpen, setCreateItemOpen] = useState(false)
  const [lineQty, setLineQty] = useState(1)
  const [linePrice, setLinePrice] = useState(0)
  const form = useForm<ReceiveFormValues>({
    resolver: zodResolver(receiveFormSchema),
    defaultValues: {
      supplier: '',
      receiptDate: toIsoDate(new Date()),
      notes: '',
    },
  })

  function addLine(item: InventoryItem, quantity: number, purchasePrice: number) {
    if (quantity <= 0) {
      toast.error('Количество должно быть больше нуля')
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
    setPicking(null)
    setLineQty(1)
    setLinePrice(item.purchasePrice)
  }

  async function onSubmit(values: ReceiveFormValues) {
    if (lines.length === 0) {
      toast.error('Добавьте хотя бы одну позицию')
      return
    }
    try {
      await receive.mutateAsync({
        supplier: values.supplier,
        receiptDate: values.receiptDate,
        notes: values.notes,
        lines: lines.map((line) => ({
          itemId: line.item.id,
          quantity: line.quantity,
          purchasePrice: line.purchasePrice,
        })),
      })
      toast.success('Приход проведён')
      form.reset({ supplier: '', receiptDate: toIsoDate(new Date()), notes: '' })
      setLines([])
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setLines([])
            setPicking(null)
          }
          onOpenChange(next)
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Новый приход</SheetTitle>
            <SheetDescription>
              Проведение создаёт партии и записи журнала одной транзакцией. Новую позицию можно добавить здесь же.
            </SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form className="flex flex-1 flex-col gap-4 px-4 pb-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="supplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Поставщик</FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="off" />
                      </FormControl>
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
                      <Textarea {...field} rows={2} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Позиции</p>
                <ItemSearchField
                  selected={picking}
                  onSelect={(item) => {
                    setPicking(item)
                    setLinePrice(item.purchasePrice)
                  }}
                  onClear={() => setPicking(null)}
                  allowCreate
                  onCreateRequest={() => setCreateItemOpen(true)}
                />
                {picking ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Кол-во</span>
                      <Input
                        type="number"
                        min={0.001}
                        step="0.001"
                        className="w-28"
                        value={lineQty}
                        onChange={(event) => setLineQty(Number(event.target.value))}
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Цена закупки</span>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-32"
                        value={linePrice}
                        onChange={(event) => setLinePrice(Number(event.target.value))}
                      />
                    </label>
                    <Button type="button" onClick={() => addLine(picking, lineQty, linePrice)}>
                      В документ
                    </Button>
                  </div>
                ) : null}

                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Строк пока нет. Считайте штрихкод или найдите позицию.</p>
                ) : (
                  <ul className="space-y-2">
                    {lines.map((line) => (
                      <li key={line.key} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">
                          {line.item.name} · {formatQuantity(line.quantity)} · {formatMoney(line.purchasePrice)}
                        </span>
                        <IconActionButton
                          label="Убрать"
                          variant="ghost"
                          onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                        >
                          <Trash2 />
                        </IconActionButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <SheetFooter className="px-0">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={receive.isPending}>
                  {receive.isPending ? 'Проведение…' : 'Провести приход'}
                </Button>
              </SheetFooter>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
      <CreateItemDialog
        open={createItemOpen}
        onOpenChange={setCreateItemOpen}
        onCreated={(item) => {
          setPicking(item)
          setLinePrice(item.purchasePrice)
        }}
      />
    </>
  )
}
