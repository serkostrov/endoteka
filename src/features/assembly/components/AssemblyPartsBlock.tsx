import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { StatusBadge } from '@/components/shared/StatusBadge'
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
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import {
  useAddAssemblyPart,
  useRemoveAssemblyPart,
  useUpdateAssemblyPart,
} from '../hooks/use-assembly'
import type { AssemblyPart } from '../services/assembly-service'

type AssemblyPartsBlockProps = {
  orderId: string
  parts: AssemblyPart[]
}

const cellPad = 'px-2 py-1.5'
const spinless =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const ghostField = cn(
  'h-8 w-full min-w-0 border-border/60 bg-background px-1.5 text-sm shadow-none md:h-7 md:border-transparent md:bg-transparent',
  'hover:border-border hover:bg-background',
  'focus-visible:border-input focus-visible:bg-background focus-visible:ring-1',
)

const assemblyPartSchema = z.object({
  name: z.string().trim().min(1, 'Укажите наименование'),
  qtyRequired: z.number().min(0, 'Не меньше 0'),
  qtyCollected: z.number().min(0, 'Не меньше 0'),
  comment: z.string().trim(),
})

type AssemblyPartFormValues = z.infer<typeof assemblyPartSchema>

const emptyPartValues: AssemblyPartFormValues = {
  name: '',
  qtyRequired: 1,
  qtyCollected: 0,
  comment: '',
}

function parseNonNegative(value: string): number | null {
  const normalized = value.replace(',', '.').trim()
  if (normalized === '') {
    return 0
  }
  const num = Number(normalized)
  if (!Number.isFinite(num) || num < 0) {
    return null
  }
  return num
}

export function AssemblyPartsBlock({ orderId, parts }: AssemblyPartsBlockProps) {
  const canEdit = useHasPermission(Permission.OrdersUpdate)
  const addPart = useAddAssemblyPart(orderId)
  const updatePart = useUpdateAssemblyPart(orderId)
  const removePart = useRemoveAssemblyPart(orderId)
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | null>(null)
  const [openedPart, setOpenedPart] = useState<AssemblyPart | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  async function handleUpdate(
    partId: string,
    patch: { name?: string; qtyRequired?: number; qtyCollected?: number; comment?: string },
  ) {
    try {
      await updatePart.mutateAsync({ partId, ...patch })
    } catch (error) {
      toast.error(getErrorMessage(error))
      throw error
    }
  }

  async function handleDelete() {
    if (!pendingDeleteId) {
      return
    }
    try {
      await removePart.mutateAsync(pendingDeleteId)
      setPendingDeleteId(null)
      toast.success('Позиция удалена')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  function closeSheet() {
    setSheetMode(null)
    setOpenedPart(null)
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-medium text-foreground">Сборка запасных частей</h3>
          <p className="text-xs text-muted-foreground">
            Позиции только для этой сборки — без склада и состава работы.
          </p>
        </div>

        {canEdit ? (
          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0"
            onClick={() => {
              setOpenedPart(null)
              setSheetMode('create')
            }}
            disabled={addPart.isPending}
          >
            <Plus className="size-4" />
            Добавить
          </Button>
        ) : null}
      </div>

      {parts.length === 0 ? (
        <EmptyState
          title="Позиций пока нет"
          description="Добавьте позицию через кнопку выше."
          className="border-dashed bg-muted/20 py-10"
        />
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {parts.map((part) => (
              <AssemblyPartCard
                key={part.id}
                part={part}
                canEdit={canEdit}
                onOpen={() => {
                  setOpenedPart(part)
                  setSheetMode('edit')
                }}
                onUpdate={handleUpdate}
                onDelete={() => setPendingDeleteId(part.id)}
              />
            ))}
          </div>

          <div className="hidden md:block">
            <Table className="min-w-[40rem] table-fixed">
              <colgroup>
                <col />
                <col style={{ width: '6.5rem' }} />
                <col style={{ width: '6.5rem' }} />
                <col style={{ width: '14rem' }} />
                <col style={{ width: '2rem' }} />
              </colgroup>
              <TableHeader>
                <TableRow className="border-b hover:bg-transparent">
                  <TableHead className={cn(cellPad, 'h-8 text-xs font-medium text-muted-foreground')}>
                    Наименование
                  </TableHead>
                  <TableHead
                    className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}
                  >
                    Требуемое
                  </TableHead>
                  <TableHead
                    className={cn(cellPad, 'h-8 text-right text-xs font-medium text-muted-foreground')}
                  >
                    Собранное
                  </TableHead>
                  <TableHead className={cn(cellPad, 'h-8 text-xs font-medium text-muted-foreground')}>
                    Комментарий
                  </TableHead>
                  <TableHead className={cn(cellPad, 'h-8')} aria-hidden />
                </TableRow>
              </TableHeader>
              <TableBody>
                {parts.map((part) => (
                  <TableRow
                    key={part.id}
                    className="group/row border-b last:border-b-0 hover:bg-muted/20"
                  >
                    <TableCell className={cn(cellPad, 'max-w-0 whitespace-normal')}>
                      <button
                        type="button"
                        className="max-w-full truncate text-left text-sm font-medium text-primary hover:underline"
                        title="Открыть позицию"
                        onClick={() => {
                          setOpenedPart(part)
                          setSheetMode('edit')
                        }}
                      >
                        {part.name}
                      </button>
                    </TableCell>
                    <TableCell className={cn(cellPad, 'whitespace-nowrap text-right')}>
                      <InlineQtyField
                        value={part.qtyRequired}
                        disabled={!canEdit}
                        ariaLabel="Требуемое"
                        onCommit={(next) => {
                          if (next === part.qtyRequired) {
                            return
                          }
                          void handleUpdate(part.id, { qtyRequired: next })
                        }}
                      />
                    </TableCell>
                    <TableCell className={cn(cellPad, 'whitespace-nowrap text-right')}>
                      <InlineQtyField
                        value={part.qtyCollected}
                        disabled={!canEdit}
                        ariaLabel="Собранное"
                        onCommit={(next) => {
                          if (next === part.qtyCollected) {
                            return
                          }
                          void handleUpdate(part.id, { qtyCollected: next })
                        }}
                      />
                    </TableCell>
                    <TableCell className={cn(cellPad, 'max-w-0')}>
                      {canEdit ? (
                        <Input
                          defaultValue={part.comment}
                          placeholder="—"
                          aria-label="Комментарий"
                          className={ghostField}
                          onBlur={(event) => {
                            const next = event.target.value.trim()
                            if (next === part.comment) {
                              return
                            }
                            void handleUpdate(part.id, { comment: next })
                          }}
                        />
                      ) : (
                        <span className="block truncate text-sm text-muted-foreground">
                          {part.comment || '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={cellPad}>
                      {canEdit ? (
                        <IconActionButton
                          label="Удалить"
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100 focus-visible:opacity-100"
                          onClick={() => setPendingDeleteId(part.id)}
                        >
                          <Trash2 />
                        </IconActionButton>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <AssemblyPartSheet
        mode={sheetMode === 'create' ? 'create' : 'edit'}
        part={sheetMode === 'edit' ? openedPart : null}
        open={sheetMode !== null}
        canEdit={canEdit}
        pending={addPart.isPending || updatePart.isPending}
        onOpenChange={(open) => {
          if (!open) {
            closeSheet()
          }
        }}
        onSave={async (values) => {
          if (sheetMode === 'create') {
            await addPart.mutateAsync({
              name: values.name,
              qtyRequired: values.qtyRequired,
              qtyCollected: values.qtyCollected,
              comment: values.comment,
            })
            toast.success('Позиция добавлена в сборку')
            closeSheet()
            return
          }
          if (!openedPart) {
            return
          }
          await handleUpdate(openedPart.id, values)
          toast.success('Позиция сохранена')
          closeSheet()
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteId(null)
          }
        }}
        title="Удалить позицию?"
        description="Позиция будет удалена из сборки запасных частей."
        confirmLabel="Удалить"
        isPending={removePart.isPending}
        onConfirm={() => void handleDelete()}
      />
    </section>
  )
}

function AssemblyPartSheet({
  mode,
  part,
  open,
  canEdit,
  pending,
  onOpenChange,
  onSave,
}: {
  mode: 'create' | 'edit'
  part: AssemblyPart | null
  open: boolean
  canEdit: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSave: (values: AssemblyPartFormValues) => Promise<void>
}) {
  const isCreate = mode === 'create'
  const form = useForm<AssemblyPartFormValues>({
    resolver: zodResolver(assemblyPartSchema),
    defaultValues: emptyPartValues,
  })

  useEffect(() => {
    if (!open) {
      return
    }
    if (isCreate) {
      form.reset(emptyPartValues)
      return
    }
    if (!part) {
      return
    }
    form.reset({
      name: part.name,
      qtyRequired: part.qtyRequired,
      qtyCollected: part.qtyCollected,
      comment: part.comment,
    })
  }, [form, open, isCreate, part])

  if (!isCreate && !part) {
    return null
  }

  const dirty = form.formState.isDirty
  const editable = canEdit || isCreate

  return (
    <Sheet open={open} dirty={dirty} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isCreate ? 'Новая позиция сборки' : 'Позиция сборки'}</SheetTitle>
          <SheetDescription>
            Только для этой сборки заказа — без справочника и склада.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={form.handleSubmit((values) => {
              void (async () => {
                if (!editable) {
                  onOpenChange(false)
                  return
                }
                if (!isCreate && !form.formState.isDirty) {
                  onOpenChange(false)
                  return
                }
                try {
                  await onSave(values)
                } catch (error) {
                  toast.error(getErrorMessage(error))
                }
              })()
            })}
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Наименование
                    <StatusBadge tone="neutral" className="text-[10px] font-normal">
                      Только для сборки
                    </StatusBadge>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" autoFocus={isCreate} disabled={!editable} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="qtyRequired"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Требуемое</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        className="tabular-nums"
                        disabled={!editable}
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(event) => field.onChange(Number(event.target.value))}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="qtyCollected"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Собранное</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        className="tabular-nums"
                        disabled={!editable}
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(event) => field.onChange(Number(event.target.value))}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Комментарий</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} disabled={!editable} className="resize-y" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SheetFooter className="px-0">
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  {dirty && editable ? 'Отмена' : 'Закрыть'}
                </Button>
              </SheetClose>
              {editable && (isCreate || dirty) ? (
                <Button type="submit" disabled={pending}>
                  {pending ? 'Сохранение…' : isCreate ? 'Добавить' : 'Готово'}
                </Button>
              ) : null}
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

function InlineQtyField({
  value,
  disabled,
  ariaLabel,
  onCommit,
}: {
  value: number
  disabled: boolean
  ariaLabel: string
  onCommit: (next: number) => void
}) {
  if (disabled) {
    return <span className="block text-sm tabular-nums text-foreground">{value}</span>
  }

  return (
    <Input
      type="number"
      min={0}
      step="any"
      aria-label={ariaLabel}
      className={cn(
        spinless,
        ghostField,
        'text-right tabular-nums md:ml-auto md:w-[3.25rem] md:px-0.5',
      )}
      defaultValue={value}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
      onBlur={(event) => {
        const parsed = parseNonNegative(event.target.value)
        if (parsed === null) {
          event.target.value = String(value)
          toast.error('Количество не может быть отрицательным.')
          return
        }
        event.target.value = String(parsed)
        onCommit(parsed)
      }}
    />
  )
}

function AssemblyPartCard({
  part,
  canEdit,
  onOpen,
  onUpdate,
  onDelete,
}: {
  part: AssemblyPart
  canEdit: boolean
  onOpen: () => void
  onUpdate: (
    partId: string,
    patch: { name?: string; qtyRequired?: number; qtyCollected?: number; comment?: string },
  ) => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-lg border bg-card p-3 shadow-xs">
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          title="Открыть позицию"
          onClick={onOpen}
        >
          <p className="truncate text-sm font-medium text-primary hover:underline">{part.name}</p>
        </button>
        {canEdit ? (
          <IconActionButton
            label="Удалить"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 />
          </IconActionButton>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Требуемое</span>
          <InlineQtyField
            value={part.qtyRequired}
            disabled={!canEdit}
            ariaLabel="Требуемое"
            onCommit={(next) => {
              if (next !== part.qtyRequired) {
                void onUpdate(part.id, { qtyRequired: next })
              }
            }}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Собранное</span>
          <InlineQtyField
            value={part.qtyCollected}
            disabled={!canEdit}
            ariaLabel="Собранное"
            onCommit={(next) => {
              if (next !== part.qtyCollected) {
                void onUpdate(part.id, { qtyCollected: next })
              }
            }}
          />
        </label>
      </div>

      <label className="mt-2 block space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">Комментарий</span>
        {canEdit ? (
          <Input
            defaultValue={part.comment}
            placeholder="—"
            aria-label="Комментарий"
            className={ghostField}
            onBlur={(event) => {
              const next = event.target.value.trim()
              if (next !== part.comment) {
                void onUpdate(part.id, { comment: next })
              }
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{part.comment || '—'}</p>
        )}
      </label>
    </div>
  )
}
