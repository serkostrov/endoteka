import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { SERIAL_LOOKUP_DEBOUNCE_MS, SERIAL_LOOKUP_MIN_LENGTH } from '@/lib/constants/devices'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { DeviceClassificationFields } from './DeviceClassificationFields'
import { CLASSIFICATION_NONE, emptyToNull } from '../classification'
import { useCreateDevice, useSerialSearch } from '../hooks/use-devices'
import { createDeviceSchema, type CreateDeviceFormValues, type DeviceClassificationFormValues } from '../schemas'
import { isDeviceDuplicateError, type Device } from '../services/devices-service'

type CreateDeviceDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultSerial?: string
  defaultCustomerId?: string
  onCreated?: (device: Device) => void
}

export function CreateDeviceDialog({
  open,
  onOpenChange,
  defaultSerial = '',
  defaultCustomerId = '',
  onCreated,
}: CreateDeviceDialogProps) {
  const create = useCreateDevice()
  const [duplicateId, setDuplicateId] = useState<string | null>(null)

  const form = useForm<CreateDeviceFormValues>({
    resolver: zodResolver(createDeviceSchema),
    defaultValues: emptyValues(defaultSerial, defaultCustomerId),
  })

  const [serialValue, setSerialValue] = useState(defaultSerial)
  const debouncedSerial = useDebouncedValue(serialValue.trim(), SERIAL_LOOKUP_DEBOUNCE_MS)
  const existingQuery = useSerialSearch(
    debouncedSerial,
    open && debouncedSerial.trim().length >= SERIAL_LOOKUP_MIN_LENGTH,
  )
  const existing = existingQuery.data?.kind === 'exact' ? existingQuery.data.device : null
  const blockingId = duplicateId || existing?.id || null

  async function onSubmit(values: CreateDeviceFormValues) {
    if (blockingId) {
      return
    }

    try {
      const id = await create.mutateAsync({
        serialNumber: values.serialNumber,
        customerId: emptyToNull(values.customerId),
        groupId: emptyToNull(values.groupId),
        brandId: emptyToNull(values.brandId),
        modelId: emptyToNull(values.modelId),
        modificationId: emptyToNull(values.modificationId),
      })
      toast.success('Прибор создан')
      form.reset(emptyValues('', defaultCustomerId))
      onOpenChange(false)
      onCreated?.({
        id,
        serialNumber: values.serialNumber.trim(),
        groupId: emptyToNull(values.groupId),
        brandId: emptyToNull(values.brandId),
        modelId: emptyToNull(values.modelId),
        modificationId: emptyToNull(values.modificationId),
        groupName: '',
        brandName: '',
        modelName: '',
        modificationName: '',
        label: 'Прибор',
        notes: '',
        warranty: null,
        createdAt: '',
        updatedAt: '',
      })
    } catch (error) {
      if (isDeviceDuplicateError(error)) {
        setDuplicateId(error.existingDeviceId)
        form.setError('serialNumber', { message: error.message })
        return
      }
      form.setError('serialNumber', { message: getErrorMessage(error) })
    }
  }

  const defaults = useMemo(
    () => emptyValues(defaultSerial, defaultCustomerId),
    [defaultCustomerId, defaultSerial],
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        form.reset(defaults)
        setSerialValue(defaults.serialNumber)
        setDuplicateId(null)
        onOpenChange(next)
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Новый прибор</SheetTitle>
          <SheetDescription>Серийный номер уникален. Классификация берётся из справочников.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form className="flex flex-1 flex-col gap-4 px-4 pb-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FormField
              control={form.control}
              name="serialNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Серийный номер</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      onChange={(event) => {
                        setDuplicateId(null)
                        setSerialValue(event.target.value)
                        field.onChange(event)
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {blockingId ? (
              <Alert>
                <AlertTitle>Прибор с таким серийным номером уже существует</AlertTitle>
                <AlertDescription>
                  <Button asChild variant="link" className="h-auto px-0">
                    <Link to={routes.device.replace(':id', blockingId)}>Открыть прибор</Link>
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <DeviceClassificationFields
              form={form as unknown as UseFormReturn<DeviceClassificationFormValues>}
            />
            <SheetFooter className="px-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={create.isPending || Boolean(blockingId)}>
                {create.isPending ? 'Сохранение…' : 'Создать'}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

function emptyValues(serial: string, customerId: string): CreateDeviceFormValues {
  return {
    serialNumber: serial,
    customerId: customerId || CLASSIFICATION_NONE,
    groupId: CLASSIFICATION_NONE,
    brandId: CLASSIFICATION_NONE,
    modelId: CLASSIFICATION_NONE,
    modificationId: CLASSIFICATION_NONE,
  }
}
