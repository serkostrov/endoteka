import { FieldType } from '@/lib/constants/fields'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

import type { DynamicFieldDefinition, DynamicFieldValueData } from '../services/fields-service'

type DynamicFieldRendererProps = {
  field: DynamicFieldDefinition
  value: DynamicFieldValueData
  onChange: (value: DynamicFieldValueData) => void
  disabled?: boolean
  error?: string
}

export function DynamicFieldRenderer({
  field,
  value,
  onChange,
  disabled = false,
  error,
}: DynamicFieldRendererProps) {
  const controlId = `dynamic-field-${field.code}`
  const options = visibleOptions(field, value)

  return (
    <div className="space-y-2">
      <Label htmlFor={controlId}>
        {field.name}
        {field.isRequired ? <span className="text-destructive"> *</span> : null}
      </Label>

      {field.fieldType === FieldType.Text ? (
        <Input
          id={controlId}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}

      {field.fieldType === FieldType.Number ? (
        <Input
          id={controlId}
          type="number"
          inputMode="decimal"
          value={typeof value === 'number' ? String(value) : ''}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            const next = event.target.value
            onChange(next === '' ? null : Number(next))
          }}
        />
      ) : null}

      {field.fieldType === FieldType.Select ? (
        <Select
          value={typeof value === 'string' && value !== '' ? value : undefined}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger id={controlId} className="w-full" aria-invalid={Boolean(error)}>
            <SelectValue placeholder="Выберите значение" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.code} value={option.code}>
                {option.label}
                {option.isActive ? '' : ' (скрыт)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {field.fieldType !== FieldType.Text &&
      field.fieldType !== FieldType.Number &&
      field.fieldType !== FieldType.Select ? (
        <p className="text-sm text-muted-foreground">Тип поля пока не поддерживается в форме.</p>
      ) : null}

      {error ? <p className={cn('text-sm text-destructive')}>{error}</p> : null}
    </div>
  )
}

function visibleOptions(field: DynamicFieldDefinition, value: DynamicFieldValueData) {
  return field.options.filter((option) => option.isActive || option.code === value)
}
