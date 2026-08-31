import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useReferenceItemsBySetCode } from '@/features/references'
import { ReferenceSetCode } from '@/lib/constants/references'
import type { UseFormReturn } from 'react-hook-form'

import type { DeviceClassificationFormValues } from '../schemas'
import { CLASSIFICATION_NONE } from '../classification'

type DeviceClassificationFieldsProps = {
  form: UseFormReturn<DeviceClassificationFormValues>
  disabled?: boolean
}

export function DeviceClassificationFields({ form, disabled = false }: DeviceClassificationFieldsProps) {
  const groups = useReferenceItemsBySetCode(ReferenceSetCode.DeviceGroups)
  const brands = useReferenceItemsBySetCode(ReferenceSetCode.DeviceBrands)
  const models = useReferenceItemsBySetCode(ReferenceSetCode.DeviceModels)
  const modifications = useReferenceItemsBySetCode(ReferenceSetCode.DeviceModifications)

  const brandId = form.watch('brandId')
  const modelId = form.watch('modelId')

  const modelOptions = (models.data ?? []).filter((item) => {
    if (!item.isActive) {
      return false
    }
    return brandId === CLASSIFICATION_NONE ? !item.parentId : item.parentId === brandId
  })
  const modificationOptions = (modifications.data ?? []).filter((item) => {
    if (!item.isActive) {
      return false
    }
    return modelId === CLASSIFICATION_NONE ? !item.parentId : item.parentId === modelId
  })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <RefSelect
        form={form}
        name="groupId"
        label="Тип прибора"
        disabled={disabled}
        items={(groups.data ?? []).filter((item) => item.isActive)}
      />
      <RefSelect
        form={form}
        name="brandId"
        label="Производитель"
        disabled={disabled}
        items={(brands.data ?? []).filter((item) => item.isActive)}
        onValueChange={() => {
          form.setValue('modelId', CLASSIFICATION_NONE)
          form.setValue('modificationId', CLASSIFICATION_NONE)
        }}
      />
      <RefSelect
        form={form}
        name="modelId"
        label="Модель"
        disabled={disabled}
        items={modelOptions}
        onValueChange={() => form.setValue('modificationId', CLASSIFICATION_NONE)}
      />
      <RefSelect
        form={form}
        name="modificationId"
        label="Модификация"
        disabled={disabled}
        items={modificationOptions}
      />
    </div>
  )
}

function RefSelect({
  form,
  name,
  label,
  items,
  disabled,
  onValueChange,
}: {
  form: UseFormReturn<DeviceClassificationFormValues>
  name: keyof DeviceClassificationFormValues
  label: string
  items: { id: string; name: string }[]
  disabled?: boolean
  onValueChange?: () => void
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            value={field.value}
            disabled={disabled}
            onValueChange={(next) => {
              field.onChange(next)
              onValueChange?.()
            }}
          >
            <FormControl>
              <SelectTrigger className="w-full" aria-label={label}>
                <SelectValue placeholder="Не указано" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={CLASSIFICATION_NONE}>Не указано</SelectItem>
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
