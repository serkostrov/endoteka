import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
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
  useSheetDirty,
} from '@/components/ui/sheet'
import { useHasPermission } from '@/features/auth'
import { DynamicFieldRenderer, DynamicFieldsGrid, saveDynamicFieldValues } from '@/features/dynamic-fields'
import { emptyFieldValue, filledFieldValues } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { FieldEntity } from '@/lib/constants/fields'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { formatDate } from '@/lib/utils/date'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { DeviceClassificationFields } from './DeviceClassificationFields'
import { WarrantyBadge } from './WarrantyBadge'
import { CLASSIFICATION_NONE, deviceSerialLine, deviceTitle, emptyToNull } from '../classification'
import { useUpdateDevice } from '../hooks/use-devices'
import { deviceClassificationSchema, type DeviceClassificationFormValues } from '../schemas'
import type { Device, DeviceLookup } from '../services/devices-service'

type EditDeviceDialogProps = {
  device: Device | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditDeviceDialog({ device, open, onOpenChange }: EditDeviceDialogProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{device ? deviceTitle(device) : 'Прибор'}</SheetTitle>
          <SheetDescription>
            {device ? `${deviceSerialLine(device.serialNumber)}. ` : ''}
            Серийный номер нельзя менять. Классификация и поля сохраняются сразу.
          </SheetDescription>
        </SheetHeader>
        {device ? <EditDeviceForm key={device.id} device={device} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function EditDeviceForm({ device, onDone }: { device: Device; onDone: () => void }) {
  const canUpdate = useHasPermission(Permission.DevicesUpdate)
  const update = useUpdateDevice(device.id)
  const queryClient = useQueryClient()
  const fieldsQuery = useDynamicFields(FieldEntity.Devices)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Devices, device.id)
  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const [extraValues, setExtraValues] = useState<Record<string, DynamicFieldValueData>>({})
  const extra = { ...(valuesQuery.data ?? {}), ...extraValues }
  const lookup = asLookup(device)
  const repairs = lookup?.repairs.slice(0, 5) ?? []

  const form = useForm<DeviceClassificationFormValues>({
    resolver: zodResolver(deviceClassificationSchema),
    defaultValues: {
      groupId: device.groupId ?? CLASSIFICATION_NONE,
      brandId: device.brandId ?? CLASSIFICATION_NONE,
      modelId: device.modelId ?? CLASSIFICATION_NONE,
      modificationId: device.modificationId ?? CLASSIFICATION_NONE,
    },
  })
  useSheetDirty(form.formState.isDirty || Object.keys(extraValues).length > 0, () =>
    runSheetFormSave(form.handleSubmit, persistDevice),
  )

  async function persistDevice(values: DeviceClassificationFormValues) {
    if (!canUpdate) {
      return
    }

    await update.mutateAsync({
      deviceId: device.id,
      groupId: emptyToNull(values.groupId),
      brandId: emptyToNull(values.brandId),
      modelId: emptyToNull(values.modelId),
      modificationId: emptyToNull(values.modificationId),
    })
    if (activeFields.length > 0) {
      await saveDynamicFieldValues(FieldEntity.Devices, device.id, filledFieldValues(activeFields, extra))
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.values(FieldEntity.Devices, device.id) })
    }
    toast.success('Прибор сохранён')
  }

  async function onSubmit(values: DeviceClassificationFormValues) {
    try {
      await persistDevice(values)
      onDone()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <Form {...form}>
      <form className="flex flex-1 flex-col gap-4 px-4 pb-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <div className="space-y-2">
          <Label>Серийный номер</Label>
          <Input value={device.serialNumber} disabled readOnly />
        </div>

        <div className="space-y-2">
          <Label>Гарантия</Label>
          <div className="rounded-md border px-3 py-2">
            <WarrantyBadge warranty={device.warranty} />
            {device.warranty ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(device.warranty.startsOn)} — {formatDate(device.warranty.endsOn)}
                {device.warranty.orderNumber ? ` · заказ ${device.warranty.orderNumber}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Гарантия появляется при выдаче заказа.</p>
            )}
          </div>
        </div>

        <DeviceClassificationFields form={form} disabled={!canUpdate} />

        {activeFields.length > 0 ? (
          <DynamicFieldsGrid>
            {activeFields.map((field) => (
              <DynamicFieldRenderer
                key={field.id}
                field={field}
                value={extra[field.code] ?? emptyFieldValue(field)}
                onChange={(value) => setExtraValues((current) => ({ ...current, [field.code]: value }))}
                disabled={!canUpdate}
              />
            ))}
          </DynamicFieldsGrid>
        ) : null}

        {repairs.length > 0 ? (
          <div className="space-y-2">
            <Label>Последние ремонты</Label>
            <ul className="space-y-1 rounded-md border px-3 py-2 text-sm">
              {repairs.map((repair) => (
                <li key={repair.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {repair.number} · {repair.customerName}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{repair.statusName}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <SheetFooter className="px-0">
          <SheetClose asChild>
            <Button type="button" variant="outline">
              {canUpdate ? 'Отмена' : 'Закрыть'}
            </Button>
          </SheetClose>
          {canUpdate ? (
            <Button type="submit" disabled={update.isPending || (activeFields.length > 0 && valuesQuery.isLoading)}>
              {update.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          ) : null}
        </SheetFooter>
      </form>
    </Form>
  )
}

function asLookup(device: Device): DeviceLookup | null {
  if (!('latestOrder' in device) || !('repairs' in device) || !Array.isArray(device.repairs)) {
    return null
  }
  return device as DeviceLookup
}
