import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Form, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { CustomerPicker } from '@/features/customers'
import { DevicePicker } from '@/features/devices'
import { useSerialSearch } from '@/features/devices/hooks/use-devices'
import {
  DynamicFieldRenderer,
  DynamicFieldsGrid,
  buildEntityValuesSchema,
  filledFieldValues,
  groupDynamicFields,
  saveDynamicFieldValues,
} from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { useHasPermission } from '@/features/auth'
import { SERIAL_LOOKUP_DEBOUNCE_MS } from '@/lib/constants/devices'
import { FieldEntity, isOrderBuiltinField } from '@/lib/constants/fields'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { useCreateOrder, usePreviewOrderNumber } from '../hooks/use-orders'
import { orderColumnsFromBuiltin, splitOrderFieldValues } from '../lib/order-card-fields'
import { createOrderSchema, type CreateOrderFormValues } from '../schemas'

export function CreateOrderScreen() {
  const navigate = useNavigate()
  const canUpdate = useHasPermission(Permission.OrdersUpdate)
  const previewQuery = usePreviewOrderNumber(true)
  const fieldsQuery = useDynamicFields(FieldEntity.Orders)
  const create = useCreateOrder()
  const createInFlight = useRef(false)
  const [extraValues, setExtraValues] = useState<Record<string, DynamicFieldValueData>>({})

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
    const extraParsed = extraSchema.safeParse(filledFieldValues(activeFields, extraValues))
    if (!extraParsed.success) {
      toast.error('Заполните обязательные поля заказа.')
      return
    }

    const deviceId = selectedDevice?.id ?? createdDeviceId
    if (!deviceId) {
      form.setError('deviceId', { message: 'Выберите прибор по серийному номеру' })
      return
    }

    const { builtin, extra } = splitOrderFieldValues(extraParsed.data)
    const columns = orderColumnsFromBuiltin(builtin)

    createInFlight.current = true
    try {
      const orderId = await create.mutateAsync({
        customerId: values.customerId,
        deviceId,
        claimedMalfunction: columns.claimedMalfunction,
        completeness: columns.completeness,
        externalCondition: '',
        deadline: columns.deadline,
        responsibleId: columns.responsibleId,
      })

      const extraFields = activeFields.filter((field) => !isOrderBuiltinField(field.code))
      if (canUpdate && extraFields.length > 0) {
        await saveDynamicFieldValues(FieldEntity.Orders, orderId, extra)
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

              <div className="grid gap-4">
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

          {fieldGroups.map((group) => (
            <SectionCard key={group.name} title={group.name}>
              <DynamicFieldsGrid>
                {group.fields.map((field) => (
                  <DynamicFieldRenderer
                    key={field.id}
                    field={field}
                    value={extraValues[field.code] ?? emptyFieldValue(field)}
                    onChange={(value) => setExtraValues((current) => ({ ...current, [field.code]: value }))}
                    disabled={!canUpdate && !isOrderBuiltinField(field.code)}
                  />
                ))}
              </DynamicFieldsGrid>
              {canUpdate || !group.fields.some((field) => !isOrderBuiltinField(field.code)) ? null : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Дополнительные поля можно заполнить на карточке заказа после создания.
                </p>
              )}
            </SectionCard>
          ))}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => navigate(routes.orders)}>
              Отмена
            </Button>
            <Button type="submit" disabled={create.isPending || fieldsQuery.isPending}>
              {create.isPending ? 'Создание…' : 'Создать заказ'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
