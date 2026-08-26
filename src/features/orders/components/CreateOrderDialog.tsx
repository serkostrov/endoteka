import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { Cpu, FileText, User, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { DatePicker } from '@/components/shared/DatePicker'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentUser, useHasPermission } from '@/features/auth'
import { CustomerPicker } from '@/features/customers'
import { DevicePicker } from '@/features/devices'
import { useSerialSearch } from '@/features/devices/hooks/use-devices'
import { addOrderJournalNote } from '@/features/diagnostics/services/diagnostics-service'
import { DynamicFieldRenderer, buildEntityValuesSchema, groupDynamicFields, saveDynamicFieldValues } from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { SERIAL_LOOKUP_DEBOUNCE_MS } from '@/lib/constants/devices'
import { FieldEntity } from '@/lib/constants/fields'
import { OrderJournalEventType } from '@/lib/constants/orders'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { toDate } from '@/lib/utils/date'

import { useCreateOrder, usePreviewOrderNumber } from '../hooks/use-orders'
import { orderJournalEventTypeLabel } from '../lib/journal-labels'
import { createOrderSchema, type CreateOrderFormValues } from '../schemas'
import { uploadOrderFile } from '../services/orders-service'
import { OrderJournalComposer } from './OrderJournalComposer'

const NONE = '__none__'

type CreateOrderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AfterCreate = 'close' | 'open' | 'again'

type JournalDraft =
  | { id: string; kind: 'comment'; body: string; createdAt: string }
  | { id: string; kind: 'attachment'; file: File; previewUrl: string | null; createdAt: string }

export function CreateOrderDialog({ open, onOpenChange }: CreateOrderDialogProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,80rem)]"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="flex items-center gap-2">
            Новый заказ
          </SheetTitle>
          <SheetDescription>Приём прибора. Доска заказов остаётся на фоне.</SheetDescription>
        </SheetHeader>
        {open ? <CreateOrderForm onOpenChange={onOpenChange} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function CreateOrderForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const canUpdate = useHasPermission(Permission.OrdersUpdate)
  const previewQuery = usePreviewOrderNumber(true)
  const employees = useActiveEmployees()
  const fieldsQuery = useDynamicFields(FieldEntity.Orders)
  const create = useCreateOrder()
  const createInFlight = useRef(false)
  const afterCreateRef = useRef<AfterCreate>('close')
  const [extraValues, setExtraValues] = useState<Record<string, DynamicFieldValueData>>({})
  const [journalDrafts, setJournalDrafts] = useState<JournalDraft[]>([])
  const journalDraftsRef = useRef(journalDrafts)
  journalDraftsRef.current = journalDrafts

  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const fieldGroups = useMemo(() => groupDynamicFields(activeFields), [activeFields])

  const form = useForm<CreateOrderFormValues>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      customerId: '',
      deviceId: '',
      claimedMalfunction: '',
      completeness: '',
      externalCondition: '',
      deadline: '',
      responsibleId: NONE,
    },
  })

  const [serial, setSerial] = useState('')
  const [createdDeviceId, setCreatedDeviceId] = useState<string | null>(null)
  const customerId = form.watch('customerId')
  const debouncedSerial = useDebouncedValue(serial.trim(), SERIAL_LOOKUP_DEBOUNCE_MS)
  const serialSearch = useSerialSearch(debouncedSerial)
  const selectedDevice = serialSearch.data?.kind === 'exact' ? serialSearch.data.device : null

  useEffect(() => {
    if (!selectedDevice?.id) {
      return
    }
    form.setValue('deviceId', selectedDevice.id, { shouldValidate: true })
  }, [form, selectedDevice?.id])

  function clearJournalDrafts() {
    setJournalDrafts((current) => {
      for (const entry of current) {
        if (entry.kind === 'attachment' && entry.previewUrl) {
          URL.revokeObjectURL(entry.previewUrl)
        }
      }
      return []
    })
  }

  function resetForm() {
    form.reset()
    setSerial('')
    setCreatedDeviceId(null)
    setExtraValues({})
    clearJournalDrafts()
  }

  useEffect(() => {
    return () => {
      for (const entry of journalDraftsRef.current) {
        if (entry.kind === 'attachment' && entry.previewUrl) {
          URL.revokeObjectURL(entry.previewUrl)
        }
      }
    }
  }, [])

  async function onSubmit(values: CreateOrderFormValues) {
    if (createInFlight.current) {
      return
    }

    const extraSchema = buildEntityValuesSchema(activeFields)
    const extraParsed = extraSchema.safeParse(filledExtraValues(activeFields, extraValues))
    if (!extraParsed.success) {
      toast.error('Заполните дополнительные поля заказа.')
      return
    }

    const deviceId = selectedDevice?.id ?? createdDeviceId
    if (!deviceId) {
      form.setError('deviceId', { message: 'Выберите прибор по серийному номеру' })
      return
    }

    createInFlight.current = true
    try {
      const orderId = await create.mutateAsync({
        customerId: values.customerId,
        deviceId,
        claimedMalfunction: values.claimedMalfunction,
        completeness: values.completeness,
        externalCondition: values.externalCondition,
        deadline: values.deadline || null,
        responsibleId: values.responsibleId === NONE ? null : values.responsibleId,
      })

      if (canUpdate && activeFields.length > 0) {
        await saveDynamicFieldValues(FieldEntity.Orders, orderId, extraParsed.data)
      }

      if (journalDrafts.length > 0) {
        try {
          await persistJournalDrafts(orderId, journalDrafts)
        } catch (error) {
          toast.warning(`Заказ создан, но журнал сохранился не полностью: ${getErrorMessage(error)}`)
        }
      }

      toast.success('Заказ создан')

      if (afterCreateRef.current === 'open') {
        onOpenChange(false)
        navigate(routes.order.replace(':id', orderId))
        return
      }

      if (afterCreateRef.current === 'again') {
        resetForm()
        return
      }

      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      createInFlight.current = false
    }
  }

  return (
    <Form {...form}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          const deviceId = selectedDevice?.id ?? createdDeviceId ?? ''
          form.setValue('deviceId', deviceId, { shouldValidate: true })
          void form.handleSubmit(onSubmit)(event)
        }}
        noValidate
      >
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">Номер заказа</p>
                <p className="mt-1 text-base font-semibold tracking-tight">{previewQuery.data || 'ЗК-…'}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Присвоится при создании</p>
              </div>
              <FormField
                control={form.control}
                name="responsibleId"
                render={({ field }) => (
                  <FormItem className="rounded-xl border bg-card px-3 py-2.5">
                    <FormLabel className="text-xs text-muted-foreground">Ответственный</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full" aria-label="Ответственный">
                          <SelectValue placeholder="Не назначен" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Не назначен</SelectItem>
                        {(employees.data ?? []).map((employee) => (
                          <SelectItem key={employee.id} value={employee.id}>
                            {employee.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="deadline"
                render={({ field }) => (
                  <FormItem className="rounded-xl border bg-card px-3 py-2.5">
                    <FormLabel className="text-xs text-muted-foreground">Срок ремонта</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-stretch">
              <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2">
                  <User className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <h3 className="text-sm font-semibold">
                    Клиент <span className="text-destructive">*</span>
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground">Кто сдаёт прибор. Найдите или создайте карточку.</p>
                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <FormLabel className="sr-only">Клиент</FormLabel>
                      <CustomerPicker
                        value={field.value}
                        onChange={(customer) => field.onChange(customer?.id ?? '')}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </section>

              <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
                  <h3 className="text-sm font-semibold">
                    Прибор <span className="text-destructive">*</span>
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground">По серийному номеру. История ремонтов не зависит от клиента.</p>
                <FormField
                  control={form.control}
                  name="deviceId"
                  render={() => (
                    <FormItem className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <FormLabel className="sr-only">Серийный номер и модель</FormLabel>
                      <DevicePicker
                        serial={serial}
                        customerId={customerId || undefined}
                        onSerialChange={(next) => {
                          setSerial(next)
                          setCreatedDeviceId(null)
                          form.setValue('deviceId', '', { shouldValidate: false })
                          form.clearErrors('deviceId')
                        }}
                        onSelectDevice={(device) => {
                          form.setValue('deviceId', device.id, { shouldValidate: true })
                        }}
                        result={serialSearch}
                        isDebouncing={serial.trim() !== debouncedSerial}
                        onCreated={(device) => {
                          setSerial(device.serialNumber)
                          setCreatedDeviceId(device.id)
                          form.setValue('deviceId', device.id, { shouldValidate: true })
                        }}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </section>
            </div>

            <section className="mt-5 space-y-4 rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold">Приёмка</h3>
              <FormField
                control={form.control}
                name="claimedMalfunction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Заявленная неисправность <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={4}
                        className="min-h-24 field-sizing-fixed"
                        placeholder="Что не работает: нет изображения, не включается, затекает…"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="completeness"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Комплектность</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={4}
                          className="min-h-24 field-sizing-fixed"
                          placeholder="Чехол, клапан, кабель, инструкция…"
                        />
                      </FormControl>
                      <FormDescription>Что пришло вместе с прибором.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="externalCondition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Внешнее состояние</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={4}
                          className="min-h-24 field-sizing-fixed"
                          placeholder="Царапины, вмятины, следы жидкости…"
                        />
                      </FormControl>
                      <FormDescription>Видимые повреждения и следы эксплуатации.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </section>

            {fieldGroups.map((group, index) => (
              <section key={group.name} className="mt-5 space-y-4 rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold">{group.name}</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  {group.fields.map((field) => (
                    <DynamicFieldRenderer
                      key={field.id}
                      field={field}
                      value={extraValues[field.code] ?? emptyFieldValue(field)}
                      onChange={(value) => setExtraValues((current) => ({ ...current, [field.code]: value }))}
                      disabled={!canUpdate}
                    />
                  ))}
                </div>
                {canUpdate || index > 0 ? null : (
                  <p className="text-sm text-muted-foreground">
                    Эти поля можно заполнить на карточке заказа после создания.
                  </p>
                )}
              </section>
            ))}
          </div>

          <aside className="flex h-80 shrink-0 flex-col border-t bg-muted/20 lg:h-auto lg:w-80 lg:border-t-0 lg:border-l xl:w-96">
            <div className="border-b px-3 py-2">
              <p className="text-sm font-medium">Журнал</p>
              <p className="text-xs text-muted-foreground">Записи сохранятся вместе с заказом</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {journalDrafts.length === 0 ? (
                <EmptyState
                  className="border-0 bg-transparent py-8"
                  title="Событий нет"
                  description="Напишите событие или прикрепите фото — сохранится после создания заказа."
                />
              ) : (
                <ol className="relative space-y-4 border-l border-border pl-4">
                  {journalDrafts.map((entry) => (
                    <li key={entry.id} className="relative">
                      <span className="absolute top-1.5 -left-5 size-2 rounded-full bg-primary" />
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-info/12 px-1.5 py-0.5 text-xs font-medium text-info">
                          {orderJournalEventTypeLabel(
                            entry.kind === 'comment'
                              ? OrderJournalEventType.Comment
                              : OrderJournalEventType.Attachment,
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {toDate(entry.createdAt) ? format(toDate(entry.createdAt) as Date, 'HH:mm') : ''}
                        </span>
                        <button
                          type="button"
                          className="ml-auto rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                          aria-label="Удалить запись"
                          onClick={() => {
                            setJournalDrafts((current) => {
                              const next = current.filter((item) => item.id !== entry.id)
                              if (entry.kind === 'attachment' && entry.previewUrl) {
                                URL.revokeObjectURL(entry.previewUrl)
                              }
                              return next
                            })
                          }}
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                      {entry.kind === 'comment' ? (
                        <p className="text-sm whitespace-pre-wrap">{entry.body}</p>
                      ) : (
                        <>
                          <p className="text-sm">Добавлен файл: {entry.file.name}</p>
                          {entry.previewUrl ? (
                            <img
                              src={entry.previewUrl}
                              alt={entry.file.name}
                              className="mt-2 size-16 rounded-md object-cover"
                            />
                          ) : (
                            <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <FileText className="size-3" />
                              PDF
                            </p>
                          )}
                        </>
                      )}
                      {user?.fullName ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{user.fullName}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <OrderJournalComposer
              disabled={create.isPending}
              hint="Сохранится вместе с заказом. Enter — отправить, Shift+Enter — новая строка."
              onSubmit={({ text, files }) => {
                const createdAt = new Date().toISOString()
                const next: JournalDraft[] = []

                for (const file of files) {
                  next.push({
                    id: crypto.randomUUID(),
                    kind: 'attachment',
                    file,
                    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
                    createdAt,
                  })
                }

                if (text) {
                  next.push({
                    id: crypto.randomUUID(),
                    kind: 'comment',
                    body: text,
                    createdAt,
                  })
                }

                setJournalDrafts((current) => [...next.reverse(), ...current])
              }}
            />
          </aside>
        </div>

        <SheetFooter className="flex-row flex-wrap justify-start gap-2 border-t">
          <Button type="submit" disabled={create.isPending} onClick={() => { afterCreateRef.current = 'close' }}>
            {create.isPending ? 'Создание…' : 'Создать'}
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={create.isPending}
            onClick={() => {
              afterCreateRef.current = 'open'
            }}
          >
            Создать и открыть
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={create.isPending}
            onClick={() => {
              afterCreateRef.current = 'again'
            }}
          >
            Создать ещё
          </Button>
        </SheetFooter>
      </form>
    </Form>
  )
}

async function persistJournalDrafts(orderId: string, drafts: JournalDraft[]) {
  for (const entry of [...drafts].reverse()) {
    if (entry.kind === 'comment') {
      await addOrderJournalNote(orderId, entry.body)
    } else {
      await uploadOrderFile(orderId, entry.file, '')
    }
  }
}

function filledExtraValues(
  fields: { code: string; fieldType: string }[],
  values: Record<string, DynamicFieldValueData>,
) {
  const result: Record<string, DynamicFieldValueData> = {}
  for (const field of fields) {
    result[field.code] = values[field.code] ?? (field.fieldType === 'number' ? null : '')
  }
  return result
}
