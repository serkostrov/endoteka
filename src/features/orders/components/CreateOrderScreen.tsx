import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { DatePicker } from '@/components/shared/DatePicker'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CustomerPicker } from '@/features/customers'
import { DevicePicker } from '@/features/devices'
import { useSerialSearch } from '@/features/devices/hooks/use-devices'
import { DynamicFieldRenderer, buildEntityValuesSchema, saveDynamicFieldValues } from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { useHasPermission } from '@/features/auth'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { SERIAL_LOOKUP_DEBOUNCE_MS } from '@/lib/constants/devices'
import { FieldEntity } from '@/lib/constants/fields'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { useCreateOrder, usePreviewOrderNumber } from '../hooks/use-orders'
import { createOrderSchema, type CreateOrderFormValues } from '../schemas'

const NONE = '__none__'

export function CreateOrderScreen() {
  const navigate = useNavigate()
  const canUpdate = useHasPermission(Permission.OrdersUpdate)
  const previewQuery = usePreviewOrderNumber(true)
  const employees = useActiveEmployees()
  const fieldsQuery = useDynamicFields(FieldEntity.Orders)
  const create = useCreateOrder()
  const createInFlight = useRef(false)
  const [extraValues, setExtraValues] = useState<Record<string, DynamicFieldValueData>>({})

  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )

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
  const debouncedSerial = useDebouncedValue(serial.trim(), SERIAL_LOOKUP_DEBOUNCE_MS)
  const serialSearch = useSerialSearch(debouncedSerial)
  const selectedDevice = serialSearch.data?.kind === 'exact' ? serialSearch.data.device : null

  useEffect(() => {
    if (!selectedDevice?.id) {
      return
    }
    form.setValue('deviceId', selectedDevice.id, { shouldValidate: true })
  }, [form, selectedDevice?.id])

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

      toast.success('Заказ создан')
      navigate(routes.order.replace(':id', orderId))
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      createInFlight.current = false
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Новый заказ"
        description="Приём прибора. Номер будет выдан системой при сохранении."
      />

      <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              const deviceId = selectedDevice?.id ?? createdDeviceId ?? ''
              form.setValue('deviceId', deviceId, { shouldValidate: true })
              void form.handleSubmit(onSubmit)(event)
            }}
            noValidate
          >
          <SectionCard
            title="Клиент и прибор"
            description="Номер ЗК-НННН выдаётся при сохранении. История ремонтов прибора не зависит от клиента этого заказа."
          >
            <div className="grid gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Номер заказа</p>
                <p className="text-lg font-semibold tracking-tight">{previewQuery.data || 'ЗК-…'}</p>
              </div>

              <div className="grid items-start gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>Клиент</FormLabel>
                      <CustomerPicker
                        value={field.value}
                        onChange={(customer) => field.onChange(customer?.id ?? '')}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deviceId"
                  render={() => (
                    <FormItem className="min-w-0">
                      <FormLabel>Серийный номер и модель</FormLabel>
                      <DevicePicker
                        serial={serial}
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
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Приёмка">
            <div className="grid gap-4">
              <FormField
                control={form.control}
                name="claimedMalfunction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Заявленная неисправность</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={4} />
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
                        <Textarea {...field} rows={3} />
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
                        <Textarea {...field} rows={3} />
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
              </div>
            </div>
          </SectionCard>

          {activeFields.length > 0 ? (
            <SectionCard title="Дополнительные поля">
              <div className="grid gap-4 md:grid-cols-2">
                {activeFields.map((field) => (
                  <DynamicFieldRenderer
                    key={field.id}
                    field={field}
                    value={extraValues[field.code] ?? emptyFieldValue(field)}
                    onChange={(value) => setExtraValues((current) => ({ ...current, [field.code]: value }))}
                    disabled={!canUpdate}
                  />
                ))}
              </div>
              {canUpdate ? null : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Дополнительные поля можно заполнить на карточке заказа после создания.
                </p>
              )}
            </SectionCard>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => navigate(routes.orders)}>
              Отмена
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Создание…' : 'Создать заказ'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
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
