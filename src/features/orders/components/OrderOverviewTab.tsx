import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { DatePicker } from '@/components/shared/DatePicker'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useHasPermission } from '@/features/auth'
import { CustomerPicker } from '@/features/customers'
import { DevicePicker } from '@/features/devices'
import { useSerialSearch } from '@/features/devices/hooks/use-devices'
import { DynamicFieldRenderer, DynamicFieldValue, groupDynamicFields, saveDynamicFieldValues } from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { SERIAL_LOOKUP_DEBOUNCE_MS } from '@/lib/constants/devices'
import { FieldEntity } from '@/lib/constants/fields'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { queryKeys } from '@/lib/query-keys'
import { useQueryClient } from '@tanstack/react-query'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { useUpdateOrder } from '../hooks/use-orders'
import { updateOrderRepairSchema, type UpdateOrderRepairFormValues } from '../schemas'
import type { OrderDetail } from '../services/orders-service'

const NONE = '__none__'

type OrderOverviewTabProps = {
  order: OrderDetail
}

export function OrderOverviewTab({ order }: OrderOverviewTabProps) {
  const canUpdate = useHasPermission(Permission.OrdersUpdate)
  const canAssign = useHasPermission(Permission.OrdersAssign)
  const employees = useActiveEmployees()
  const update = useUpdateOrder(order.id)
  const queryClient = useQueryClient()
  const fieldsQuery = useDynamicFields(FieldEntity.Orders)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Orders, order.id)
  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const fieldGroups = useMemo(() => groupDynamicFields(activeFields), [activeFields])
  const [extraDraft, setExtraDraft] = useState<Record<string, DynamicFieldValueData> | null>(null)
  const extraValues = extraDraft ?? valuesQuery.data ?? {}
  const [savingFields, setSavingFields] = useState(false)

  const form = useForm<UpdateOrderRepairFormValues>({
    resolver: zodResolver(updateOrderRepairSchema),
    values: toFormValues(order),
  })

  async function onSubmit(values: UpdateOrderRepairFormValues) {
    try {
      await update.mutateAsync({
        orderId: order.id,
        claimedMalfunction: canEditRepair ? values.claimedMalfunction : undefined,
        completeness: canEditRepair ? values.completeness : undefined,
        externalCondition: canEditRepair ? values.externalCondition : undefined,
        deadline: canEditRepair ? values.deadline || null : undefined,
        changeDeadline: canEditRepair,
        responsibleId: canEditResponsible ? (values.responsibleId === NONE ? null : values.responsibleId) : undefined,
        changeResponsible: canEditResponsible,
      })
      toast.success('Заказ сохранён')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function saveExtra() {
    setSavingFields(true)
    try {
      await saveDynamicFieldValues(FieldEntity.Orders, order.id, extraValues)
      setExtraDraft(null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.values(FieldEntity.Orders, order.id) })
      toast.success('Дополнительные поля сохранены')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSavingFields(false)
    }
  }

  const canEditRepair = canUpdate
  const canEditResponsible = canUpdate || canAssign

  return (
    <div className="space-y-4">
      {canEditRepair ? (
        <OrderPartiesEditor order={order} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <EntityCard
            title="Клиент"
            name={order.customerName}
            href={routes.customer.replace(':id', order.customerId)}
          />
          <EntityCard
            title="Прибор"
            name={order.deviceLabel}
            detail={`СН ${order.serialNumber}`}
            href={routes.device.replace(':id', order.deviceId)}
          />
        </div>
      )}

      <SectionCard title="Заказ">
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FormField
              control={form.control}
              name="claimedMalfunction"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Заявленная неисправность</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={4} disabled={!canEditRepair} />
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
                      <Textarea {...field} rows={3} disabled={!canEditRepair} />
                    </FormControl>
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
                      <Textarea {...field} rows={3} disabled={!canEditRepair} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="deadline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Срок</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        disabled={!canEditRepair}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="responsibleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ответственный</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!canEditResponsible}>
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
            </div>
            {canEditRepair || canEditResponsible ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending ? 'Сохранение…' : 'Сохранить'}
                </Button>
              </div>
            ) : null}
          </form>
        </Form>
      </SectionCard>

      {fieldGroups.map((group, index) => (
        <SectionCard key={group.name} title={group.name}>
          <div className="grid gap-4 md:grid-cols-2">
            {group.fields.map((field) =>
              canUpdate ? (
                <DynamicFieldRenderer
                  key={field.id}
                  field={field}
                  value={extraValues[field.code] ?? emptyFieldValue(field)}
                  onChange={(value) =>
                    setExtraDraft((current) => ({ ...(current ?? valuesQuery.data ?? {}), [field.code]: value }))
                  }
                />
              ) : (
                <div key={field.id} className="space-y-1">
                  <p className="text-sm text-muted-foreground">{field.name}</p>
                  <p className="text-sm">
                    <DynamicFieldValue field={field} value={extraValues[field.code] ?? emptyFieldValue(field)} />
                  </p>
                </div>
              ),
            )}
          </div>
          {canUpdate && index === fieldGroups.length - 1 ? (
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={() => void saveExtra()} disabled={savingFields}>
                {savingFields ? 'Сохранение…' : 'Сохранить поля'}
              </Button>
            </div>
          ) : null}
        </SectionCard>
      ))}
    </div>
  )
}

function OrderPartiesEditor({ order }: { order: OrderDetail }) {
  const update = useUpdateOrder(order.id)
  const [customerId, setCustomerId] = useState(order.customerId)
  const [serial, setSerial] = useState(order.serialNumber)
  const [createdDeviceId, setCreatedDeviceId] = useState<string | null>(null)
  const lastSavedCustomerId = useRef(order.customerId)
  const lastSavedDeviceId = useRef(order.deviceId)
  const debouncedSerial = useDebouncedValue(serial.trim(), SERIAL_LOOKUP_DEBOUNCE_MS)
  const serialSearch = useSerialSearch(debouncedSerial)
  const selectedDevice = serialSearch.data?.kind === 'exact' ? serialSearch.data.device : null
  const pending = update.isPending

  useEffect(() => {
    setCustomerId(order.customerId)
    lastSavedCustomerId.current = order.customerId
  }, [order.customerId])

  useEffect(() => {
    setSerial(order.serialNumber)
    setCreatedDeviceId(null)
    lastSavedDeviceId.current = order.deviceId
  }, [order.deviceId, order.serialNumber])

  const persistCustomer = useCallback(
    async (nextId: string) => {
      if (!nextId || nextId === lastSavedCustomerId.current) {
        return
      }
      const previous = lastSavedCustomerId.current
      lastSavedCustomerId.current = nextId
      try {
        await update.mutateAsync({
          orderId: order.id,
          customerId: nextId,
          changeCustomer: true,
        })
        toast.success('Клиент изменён')
      } catch (error) {
        lastSavedCustomerId.current = previous
        setCustomerId(order.customerId)
        toast.error(getErrorMessage(error))
      }
    },
    [order.customerId, order.id, update],
  )

  const persistDevice = useCallback(
    async (nextId: string) => {
      if (!nextId || nextId === lastSavedDeviceId.current) {
        return
      }
      const previous = lastSavedDeviceId.current
      lastSavedDeviceId.current = nextId
      try {
        await update.mutateAsync({
          orderId: order.id,
          deviceId: nextId,
          changeDevice: true,
        })
        toast.success('Прибор изменён')
      } catch (error) {
        lastSavedDeviceId.current = previous
        setSerial(order.serialNumber)
        setCreatedDeviceId(null)
        toast.error(getErrorMessage(error))
      }
    },
    [order.id, order.serialNumber, update],
  )

  useEffect(() => {
    const nextId = selectedDevice?.id ?? createdDeviceId
    if (!nextId) {
      return
    }
    void persistDevice(nextId)
  }, [createdDeviceId, persistDevice, selectedDevice?.id])

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Клиент</p>
        <CustomerPicker
          value={customerId}
          disabled={pending}
          onChange={(customer) => {
            const nextId = customer?.id ?? ''
            setCustomerId(nextId)
            if (nextId) {
              void persistCustomer(nextId)
            }
          }}
        />
        {customerId ? (
          <Button asChild variant="link" className="h-auto self-start px-0">
            <Link to={routes.customer.replace(':id', customerId)}>Открыть карточку</Link>
          </Button>
        ) : null}
      </section>

      <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Прибор</p>
        <DevicePicker
          serial={serial}
          customerId={customerId || undefined}
          disabled={pending}
          result={serialSearch}
          isDebouncing={serial.trim() !== debouncedSerial}
          onSerialChange={(next) => {
            setSerial(next)
            setCreatedDeviceId(null)
          }}
          onSelectDevice={(device) => {
            void persistDevice(device.id)
          }}
          onCreated={(device) => {
            setSerial(device.serialNumber)
            setCreatedDeviceId(device.id)
            void persistDevice(device.id)
          }}
        />
        {selectedDevice?.id || serial === order.serialNumber ? (
          <Button asChild variant="link" className="h-auto self-start px-0">
            <Link to={routes.device.replace(':id', selectedDevice?.id ?? order.deviceId)}>Открыть карточку</Link>
          </Button>
        ) : null}
      </section>
    </div>
  )
}

function EntityCard({
  title,
  name,
  detail,
  href,
}: {
  title: string
  name: string
  detail?: string
  href: string
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <p className="mt-2 text-sm font-medium">{name}</p>
      {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
      <Button asChild variant="link" className="mt-1 h-auto px-0">
        <Link to={href}>Открыть карточку</Link>
      </Button>
    </div>
  )
}

function toFormValues(order: OrderDetail): UpdateOrderRepairFormValues {
  return {
    claimedMalfunction: order.claimedMalfunction,
    completeness: order.completeness,
    externalCondition: order.externalCondition,
    deadline: order.deadline ?? '',
    responsibleId: order.responsibleId ?? NONE,
  }
}
