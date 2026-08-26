import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldType } from '@/lib/constants/fields'
import { uniqueCode } from '@/lib/utils/code'

import { DynamicFieldRenderer } from './DynamicFieldRenderer'
import { DynamicFieldValue } from './DynamicFieldValue'
import { dynamicFieldFormSchema, emptyFieldValue, type DynamicFieldFormValues } from '../schemas'
import type { DynamicFieldDefinition, DynamicFieldValueData, FieldTypeRecord } from '../services/fields-service'

type DynamicFieldEditorProps = {
  field?: DynamicFieldDefinition | null
  fieldTypes: FieldTypeRecord[]
  usageCount?: number
  isPending?: boolean
  usedCodes?: string[]
  onSubmit: (values: DynamicFieldFormValues) => Promise<void>
  onCancel: () => void
}

export function DynamicFieldEditor({
  field,
  fieldTypes,
  usageCount = 0,
  isPending = false,
  usedCodes = [],
  onSubmit,
  onCancel,
}: DynamicFieldEditorProps) {
  const [previewValue, setPreviewValue] = useState<DynamicFieldValueData>(field ? emptyFieldValue(field) : '')
  const form = useForm<DynamicFieldFormValues>({
    resolver: zodResolver(dynamicFieldFormSchema),
    defaultValues: {
      code: field?.code ?? '',
      name: field?.name ?? '',
      fieldType: field?.fieldType ?? FieldType.Text,
      isRequired: field?.isRequired ?? false,
      groupName: field?.groupName ?? '',
      options:
        field?.options.map((option) => ({
          code: option.code,
          label: option.label,
          isActive: option.isActive,
        })) ?? [],
    },
  })

  const options = useFieldArray({ control: form.control, name: 'options' })
  const fieldType = useWatch({ control: form.control, name: 'fieldType' }) ?? FieldType.Text
  const watched = useWatch({ control: form.control })
  const previewField = toPreviewField(field, {
    code: watched.code ?? '',
    name: watched.name ?? '',
    fieldType: watched.fieldType ?? FieldType.Text,
    isRequired: watched.isRequired ?? false,
    groupName: watched.groupName ?? '',
    options: (watched.options ?? []).map((option) => ({
      code: option.code ?? '',
      label: option.label ?? '',
      isActive: option.isActive ?? true,
    })),
  })
  const isUsed = usageCount > 0

  async function handleSubmit(values: DynamicFieldFormValues) {
    const code = field?.code || uniqueCode(values.name, usedCodes, 'field')
    const usedOptions = new Set(values.options.map((option) => option.code).filter(Boolean))
    await onSubmit({
      ...values,
      code,
      options: values.options.map((option) => {
        const nextCode = option.code || uniqueCode(option.label, usedOptions, 'option')
        usedOptions.add(nextCode)
        return { ...option, code: nextCode }
      }),
    })
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)} noValidate>
        {isUsed ? (
          <Alert>
            <AlertDescription>
              Поле уже используется в {usageCount} записях. Тип нельзя менять. Отключение скроет поле
              в новых формах, старые значения сохранятся.
            </AlertDescription>
          </Alert>
        ) : null}

        <FormField
          control={form.control}
          name="name"
          render={({ field: nameField }) => (
            <FormItem>
              <FormLabel>Название</FormLabel>
              <FormControl>
                <Input {...nameField} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="fieldType"
          render={({ field: typeField }) => (
            <FormItem>
              <FormLabel>Тип</FormLabel>
              <Select value={typeField.value} onValueChange={typeField.onChange} disabled={isUsed}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {fieldTypes.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.name}
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
          name="groupName"
          render={({ field: groupField }) => (
            <FormItem>
              <FormLabel>Группа</FormLabel>
              <FormControl>
                <Input {...groupField} placeholder="Например, Осмотр" />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Поля с одним названием группы показываются вместе. Пустое значение — «Прочие поля».
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isRequired"
          render={({ field: requiredField }) => (
            <FormItem>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={requiredField.value}
                  onCheckedChange={(checked) => requiredField.onChange(checked === true)}
                />
                Обязательное поле
              </label>
              <FormMessage />
            </FormItem>
          )}
        />

        {fieldType === FieldType.Select ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Варианты списка</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => options.append({ code: '', label: '', isActive: true })}
              >
                <Plus className="size-4" />
                Добавить
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Удалённые варианты скрываются, а не уничтожаются. Старые записи сохранят выбранное значение.
            </p>
            {form.formState.errors.options?.root?.message || form.formState.errors.options?.message ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.options.root?.message ?? form.formState.errors.options.message}
              </p>
            ) : null}
            <div className="space-y-2">
              {options.fields.map((option, index) => (
                <div key={option.id} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_auto_auto]">
                  <FormField
                    control={form.control}
                    name={`options.${index}.label`}
                    render={({ field: optionField }) => (
                      <FormItem>
                        <FormLabel className="sr-only">Название варианта</FormLabel>
                        <FormControl>
                          <Input {...optionField} placeholder="Название" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`options.${index}.isActive`}
                    render={({ field: optionField }) => (
                      <FormItem className="flex items-center">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={optionField.value}
                            onCheckedChange={(checked) => optionField.onChange(checked === true)}
                          />
                          Активен
                        </label>
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Убрать вариант"
                    onClick={() => options.remove(index)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-3 text-sm font-medium">Как увидит сотрудник</p>
          <div className="space-y-2">
            <DynamicFieldRenderer field={previewField} value={previewValue} onChange={setPreviewValue} />
            <p className="text-sm text-muted-foreground">
              На карточке: <DynamicFieldValue field={previewField} value={previewValue} />
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Отмена
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Form>
  )
}

function toPreviewField(
  existing: DynamicFieldDefinition | null | undefined,
  values: DynamicFieldFormValues,
): DynamicFieldDefinition {
  return {
    id: existing?.id ?? 'preview',
    entityCode: existing?.entityCode ?? 'preview',
    code: values.code || 'preview',
    name: values.name || 'Новое поле',
    fieldType: values.fieldType,
    isRequired: values.isRequired,
    groupName: values.groupName,
    isActive: true,
    sortOrder: existing?.sortOrder ?? 0,
    createdAt: existing?.createdAt ?? '',
    updatedAt: existing?.updatedAt ?? '',
    options: values.options.map((option, index) => ({
      id: `${index}`,
      code: option.code || `option_${index}`,
      label: option.label || `Вариант ${index + 1}`,
      sortOrder: index,
      isActive: option.isActive,
    })),
  }
}
