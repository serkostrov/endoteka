import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useOpenEntitySheet } from '@/app/sheet-stack'
import { SectionCard } from '@/components/shared/SectionCard'
import { useHasPermission } from '@/features/auth'
import { CustomerPicker } from '@/features/customers'
import { DevicePicker } from '@/features/devices'
import { useSerialSearch } from '@/features/devices/hooks/use-devices'
import {
  DynamicFieldRenderer,
  DynamicFieldValue,
  DynamicFieldsGrid,
  buildEntityValuesSchema,
  filledFieldValues,
  groupDynamicFields,
  saveDynamicFieldValues,
} from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { SERIAL_LOOKUP_DEBOUNCE_MS } from '@/lib/constants/devices'
import { FieldEntity, OrderBuiltinField, fieldLayoutWidthClass, isOrderBuiltinField } from '@/lib/constants/fields'
import { deviceSerialLine } from '@/features/devices/classification'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useAutosave } from '@/hooks/use-autosave'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { queryKeys } from '@/lib/query-keys'
import { useQueryClient } from '@tanstack/react-query'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { useUpdateOrder } from '../hooks/use-orders'
import type { UpdateOrderInput } from '../services/orders-service'
import {
  canEditOrderCardField,
  mergeOrderCardValues,
  orderColumnsFromBuiltin,
  sameOrderDate,
  splitOrderFieldValues,
} from '../lib/order-card-fields'
import type { OrderDetail } from '../services/orders-service'

type OrderOverviewTabProps = {
  order: OrderDetail
}

export function OrderOverviewTab({ order }: OrderOverviewTabProps) {
  const openSheet = useOpenEntitySheet()
  const canUpdate = useHasPermission(Permission.OrdersUpdate)
  const canAssign = useHasPermission(Permission.OrdersAssign)
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
  const lastSavedKey = useRef<string | null>(null)
  const cardValues = extraDraft ?? mergeOrderCardValues(order, valuesQuery.data ?? {})
  const canEditRepair = canUpdate
  const canEditResponsible = canUpdate || canAssign
  const canSaveFields =
    activeFields.length > 0 &&
    (canUpdate || activeFields.some((field) => field.code === OrderBuiltinField.Responsible && canAssign))

  const persistCard = useCallback(
    async (draft: Record<string, DynamicFieldValueData>) => {
      const values = { ...mergeOrderCardValues(order, valuesQuery.data ?? {}), ...draft }
      const key = JSON.stringify(filledFieldValues(activeFields, values))
      if (key === lastSavedKey.current) {
        return
      }

      const parsed = buildEntityValuesSchema(activeFields).safeParse(filledFieldValues(activeFields, values))
      if (!parsed.success) {
        return
      }

      const { builtin, extra } = splitOrderFieldValues(parsed.data)
      const columns = orderColumnsFromBuiltin(builtin)
      const activeCodes = new Set(activeFields.map((field) => field.code))
      const coverActive = activeCodes.has(OrderBuiltinField.CoverNote)
      const completenessActive = activeCodes.has(OrderBuiltinField.Completeness)
      const deadlineActive = activeCodes.has(OrderBuiltinField.Deadline)
      const readyDateActive = activeCodes.has(OrderBuiltinField.ReadyDate)
      const responsibleActive = activeCodes.has(OrderBuiltinField.Responsible)
      const patch: UpdateOrderInput = { orderId: order.id }

      if (canEditRepair && coverActive && columns.claimedMalfunction !== order.claimedMalfunction) {
        patch.claimedMalfunction = columns.claimedMalfunction
      }
      if (canEditRepair && completenessActive && columns.completeness !== order.completeness) {
        patch.completeness = columns.completeness
      }
      if (canEditRepair && deadlineActive && !sameOrderDate(columns.deadline, order.deadline)) {
        patch.deadline = columns.deadline
        patch.changeDeadline = true
      }
      if (canEditRepair && readyDateActive && !sameOrderDate(columns.readyDate, order.readyDate)) {
        patch.readyDate = columns.readyDate
        patch.changeReadyDate = true
      }
      if (
        canEditResponsible &&
        responsibleActive &&
        (columns.responsibleId ?? null) !== (order.responsibleId ?? null)
      ) {
        patch.responsibleId = columns.responsibleId
        patch.changeResponsible = true
      }

      const shouldUpdateOrder =
        patch.claimedMalfunction !== undefined ||
        patch.completeness !== undefined ||
        Boolean(patch.changeDeadline) ||
        Boolean(patch.changeReadyDate) ||
        Boolean(patch.changeResponsible)

      try {
        if (shouldUpdateOrder) {
          await update.mutateAsync(patch)
        }

        if (canUpdate) {
          const extraFields = activeFields.filter((field) => !isOrderBuiltinField(field.code))
          if (extraFields.length > 0) {
            await saveDynamicFieldValues(FieldEntity.Orders, order.id, extra)
          }
          await queryClient.invalidateQueries({ queryKey: queryKeys.fields.values(FieldEntity.Orders, order.id) })
        }

        lastSavedKey.current = key
        setExtraDraft((current) => {
          if (!current) {
            return null
          }
          const next = { ...mergeOrderCardValues(order, valuesQuery.data ?? {}), ...current }
          return JSON.stringify(filledFieldValues(activeFields, next)) === key ? null : current
        })
      } catch (error) {
        toast.error(getErrorMessage(error))
        throw error
      }
    },
    [
      activeFields,
      canEditRepair,
      canEditResponsible,
      canUpdate,
      order,
      queryClient,
      update,
      valuesQuery.data,
    ],
  )

  useAutosave(canSaveFields ? extraDraft : null, persistCard)

  return (
    <div className="space-y-4">
      {canEditRepair ? (
        <OrderPartiesEditor order={order} />
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          <EntityCard
            title="Прибор"
            name={order.deviceLabel}
            detail={deviceSerialLine(order.serialNumber)}
            onOpen={() => openSheet('device', order.deviceId)}
          />
          <EntityCard
            title="Клиент"
            name={order.customerName}
            onOpen={() => openSheet('customer', order.customerId)}
          />
        </div>
      )}

      {fieldGroups.map((group) => (
        <SectionCard key={group.name} title={group.name} flat>
          <DynamicFieldsGrid className="gap-x-4 gap-y-3">
            {group.fields.map((field) => {
              const editable = canEditOrderCardField(field, { canUpdate, canAssign })
              return editable ? (
                <DynamicFieldRenderer
                  key={field.id}
                  field={field}
                  value={cardValues[field.code] ?? emptyFieldValue(field)}
                  onChange={(value) =>
                    setExtraDraft((current) => ({
                      ...(current ?? mergeOrderCardValues(order, valuesQuery.data ?? {})),
                      [field.code]: value,
                    }))
                  }
                />
              ) : (
                <div key={field.id} className={cn('space-y-1.5', fieldLayoutWidthClass(field))}>
                  <p className="text-sm text-muted-foreground">{field.name}</p>
                  <p className="text-sm">
                    <DynamicFieldValue field={field} value={cardValues[field.code] ?? emptyFieldValue(field)} />
                  </p>
                </div>
              )
            })}
          </DynamicFieldsGrid>
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
  const [pickedDeviceId, setPickedDeviceId] = useState<string | null>(order.deviceId)
  const pending = update.isPending

  useEffect(() => {
    setCustomerId(order.customerId)
    lastSavedCustomerId.current = order.customerId
  }, [order.customerId])

  useEffect(() => {
    setSerial(order.serialNumber)
    setCreatedDeviceId(null)
    setPickedDeviceId(order.deviceId)
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
        setPickedDeviceId(previous)
        toast.error(getErrorMessage(error))
      }
    },
    [order.id, order.serialNumber, update],
  )

  function clearDevice() {
    setSerial('')
    setCreatedDeviceId(null)
    setPickedDeviceId(null)
  }

  return (
    <div className="grid w-full gap-2.5 md:grid-cols-2">
      <DevicePicker
        framed
        label="Прибор"
        serial={serial}
        selectedId={pickedDeviceId ?? createdDeviceId}
        customerId={customerId || undefined}
        disabled={pending}
        result={serialSearch}
        isDebouncing={serial.trim() !== debouncedSerial}
        onSerialChange={(next) => {
          setSerial(next)
          setCreatedDeviceId(null)
          setPickedDeviceId(null)
        }}
        onSelectDevice={(device) => {
          setPickedDeviceId(device.id)
          void persistDevice(device.id)
        }}
        onClear={clearDevice}
        onCreated={(device) => {
          setSerial(device.serialNumber)
          setCreatedDeviceId(device.id)
          setPickedDeviceId(device.id)
          void persistDevice(device.id)
        }}
      />
      <CustomerPicker
        framed
        label="Клиент"
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
    </div>
  )
}

function EntityCard({
  title,
  name,
  detail,
  onOpen,
}: {
  title: string
  name: string
  detail?: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/40"
    >
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <p className="mt-1 truncate text-sm font-medium">{name}</p>
      {detail ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p> : null}
    </button>
  )
}
