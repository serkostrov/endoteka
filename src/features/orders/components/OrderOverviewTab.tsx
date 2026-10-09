import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useOpenEntitySheet } from '@/app/sheet-stack'
import { SectionCard } from '@/components/shared/SectionCard'
import { useSheetDirty } from '@/components/ui/sheet'
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
import { useRegisterOrderCardSave } from '../lib/order-card-save-context'
import type { OrderDetail } from '../services/orders-service'

type OrderOverviewTabProps = {
  order: OrderDetail
}

type PartyDraft = {
  customerId: string
  deviceId: string | null
  serial: string
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
  const [partyDraft, setPartyDraft] = useState<PartyDraft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const cardValues = extraDraft ?? mergeOrderCardValues(order, valuesQuery.data ?? {})
  const canEditRepair = canUpdate
  const canEditResponsible = canUpdate || canAssign
  const canEditCard =
    canUpdate || activeFields.some((field) => field.code === OrderBuiltinField.Responsible && canAssign)
  const partiesDirty =
    partyDraft !== null &&
    (partyDraft.customerId !== order.customerId || partyDraft.deviceId !== order.deviceId)
  const fieldsDirty = extraDraft !== null
  const dirty = canEditCard && (fieldsDirty || partiesDirty)

  const persistCard = useCallback(async () => {
    if (!canEditCard) {
      return
    }

    const draft = extraDraft ?? mergeOrderCardValues(order, valuesQuery.data ?? {})
    const values = { ...mergeOrderCardValues(order, valuesQuery.data ?? {}), ...draft }
    const filled = filledFieldValues(activeFields, values)
    const parsed = buildEntityValuesSchema(activeFields).safeParse(filled)
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const code = issue.path[0]
        if (typeof code === 'string' && !nextErrors[code]) {
          nextErrors[code] = issue.message
        }
      }
      setFieldErrors(nextErrors)
      throw new Error('Заполните обязательные поля заказа.')
    }

    setFieldErrors({})
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

    if (canEditRepair && partyDraft) {
      if (partyDraft.customerId !== order.customerId) {
        if (!partyDraft.customerId) {
          throw new Error('Укажите клиента.')
        }
        patch.customerId = partyDraft.customerId
        patch.changeCustomer = true
      }
      if (partyDraft.deviceId !== order.deviceId) {
        if (!partyDraft.deviceId) {
          throw new Error('Укажите прибор.')
        }
        patch.deviceId = partyDraft.deviceId
        patch.changeDevice = true
      }
    }

    const shouldUpdateOrder =
      patch.claimedMalfunction !== undefined ||
      patch.completeness !== undefined ||
      Boolean(patch.changeDeadline) ||
      Boolean(patch.changeReadyDate) ||
      Boolean(patch.changeResponsible) ||
      Boolean(patch.changeCustomer) ||
      Boolean(patch.changeDevice)

    const extraFields = activeFields.filter((field) => !isOrderBuiltinField(field.code))
    const shouldSaveExtra = canUpdate && extraFields.length > 0 && fieldsDirty

    if (!shouldUpdateOrder && !shouldSaveExtra) {
      setExtraDraft(null)
      setPartyDraft(null)
      return
    }

    setSaving(true)
    try {
      if (shouldUpdateOrder) {
        await update.mutateAsync(patch)
      }

      if (shouldSaveExtra) {
        await saveDynamicFieldValues(FieldEntity.Orders, order.id, extra)
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.fields.values(FieldEntity.Orders, order.id),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(order.id) }),
        ])
      }

      setExtraDraft(null)
      setPartyDraft(null)
      toast.success('Заказ сохранён')
    } catch (error) {
      const message = getErrorMessage(error)
      toast.error(message)
      throw error instanceof Error ? error : new Error(message)
    } finally {
      setSaving(false)
    }
  }, [
    activeFields,
    canEditCard,
    canEditRepair,
    canEditResponsible,
    canUpdate,
    extraDraft,
    fieldsDirty,
    order,
    partyDraft,
    queryClient,
    update,
    valuesQuery.data,
  ])

  useSheetDirty(dirty, dirty ? () => persistCard() : undefined)

  const saveFromFooter = useCallback(async () => {
    try {
      await persistCard()
    } catch {
      // toast already shown; keep draft for correction
    }
  }, [persistCard])

  useRegisterOrderCardSave('overview', {
    dirty,
    saving,
    save: saveFromFooter,
    enabled: canEditCard,
  })

  return (
    <div className="space-y-4">
      {canEditRepair ? (
        <OrderPartiesEditor
          order={order}
          draft={partyDraft}
          pending={saving}
          onDraftChange={setPartyDraft}
        />
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
                  error={fieldErrors[field.code]}
                  onChange={(value) => {
                    setFieldErrors((current) => {
                      if (!current[field.code]) {
                        return current
                      }
                      const next = { ...current }
                      delete next[field.code]
                      return next
                    })
                    setExtraDraft((current) => ({
                      ...(current ?? mergeOrderCardValues(order, valuesQuery.data ?? {})),
                      [field.code]: value,
                    }))
                  }}
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

function OrderPartiesEditor({
  order,
  draft,
  pending,
  onDraftChange,
}: {
  order: OrderDetail
  draft: PartyDraft | null
  pending: boolean
  onDraftChange: (draft: PartyDraft | null) => void
}) {
  const customerId = draft?.customerId ?? order.customerId
  const serial = draft?.serial ?? order.serialNumber
  const pickedDeviceId = draft ? draft.deviceId : order.deviceId
  const debouncedSerial = useDebouncedValue(serial.trim(), SERIAL_LOOKUP_DEBOUNCE_MS)
  const serialSearch = useSerialSearch(debouncedSerial)

  useEffect(() => {
    if (!draft) {
      return
    }
    if (draft.customerId === order.customerId && draft.deviceId === order.deviceId) {
      onDraftChange(null)
    }
  }, [draft, onDraftChange, order.customerId, order.deviceId])

  function ensureDraft(): PartyDraft {
    return (
      draft ?? {
        customerId: order.customerId,
        deviceId: order.deviceId,
        serial: order.serialNumber,
      }
    )
  }

  return (
    <div className="grid w-full gap-2.5 md:grid-cols-2">
      <DevicePicker
        framed
        label="Прибор"
        serial={serial}
        selectedId={pickedDeviceId}
        customerId={customerId || undefined}
        disabled={pending}
        result={serialSearch}
        isDebouncing={serial.trim() !== debouncedSerial}
        onSerialChange={(next) => {
          onDraftChange({
            ...ensureDraft(),
            serial: next,
            deviceId: null,
          })
        }}
        onSelectDevice={(device) => {
          onDraftChange({
            ...ensureDraft(),
            serial: device.serialNumber,
            deviceId: device.id,
          })
        }}
        onClear={() => {
          onDraftChange({
            ...ensureDraft(),
            serial: '',
            deviceId: null,
          })
        }}
        onCreated={(device) => {
          onDraftChange({
            ...ensureDraft(),
            serial: device.serialNumber,
            deviceId: device.id,
          })
        }}
      />
      <CustomerPicker
        framed
        label="Клиент"
        value={customerId}
        disabled={pending}
        onChange={(customer) => {
          const nextId = customer?.id ?? ''
          onDraftChange({
            ...ensureDraft(),
            customerId: nextId,
          })
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
