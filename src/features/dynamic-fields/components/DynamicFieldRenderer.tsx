import { type ReactNode, type Ref } from 'react'

import {
  FieldType,
  fieldLayoutHeightClass,
  fieldLayoutWidthClass,
  fieldTextareaRows,
  resolvedFieldType,
} from '@/lib/constants/fields'
import { DatePicker } from '@/components/shared/DatePicker'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { cn } from '@/lib/utils'

import type { DynamicFieldDefinition, DynamicFieldValueData } from '../services/fields-service'

const EMPLOYEE_NONE = '__none__'

type DynamicFieldRendererProps = {
  field: DynamicFieldDefinition
  value: DynamicFieldValueData
  onChange: (value: DynamicFieldValueData) => void
  disabled?: boolean
  error?: string
  applyLayout?: boolean
  className?: string
}

export function DynamicFieldsGrid({
  children,
  className,
  ref,
}: {
  children: ReactNode
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  return (
    <div ref={ref} className={cn('grid grid-cols-12 gap-4', className)}>
      {children}
    </div>
  )
}

export function DynamicFieldRenderer({
  field,
  value,
  onChange,
  disabled = false,
  error,
  applyLayout = true,
  className,
}: DynamicFieldRendererProps) {
  const controlId = `dynamic-field-${field.code}`
  const fieldType = resolvedFieldType(field)
  const options = visibleOptions(field, value)
  const employees = useActiveEmployees()
  const textValue = typeof value === 'string' ? value : ''

  return (
    <div
      className={cn(
        'min-w-0 space-y-2',
        applyLayout && fieldLayoutWidthClass(field),
        fieldLayoutHeightClass(field),
        className,
      )}
    >
      {fieldType === FieldType.Checkbox ? (
        <label htmlFor={controlId} className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            id={controlId}
            checked={value === true}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          {field.name}
          {field.isRequired ? <span className="text-destructive"> *</span> : null}
        </label>
      ) : (
        <Label htmlFor={controlId}>
          {field.name}
          {field.isRequired ? <span className="text-destructive"> *</span> : null}
        </Label>
      )}

      {fieldType === FieldType.Checkbox ? null : fieldType === FieldType.Textarea ? (
        <Textarea
          id={controlId}
          value={textValue}
          disabled={disabled}
          rows={fieldTextareaRows(field)}
          className="field-sizing-fixed"
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : fieldType === FieldType.Date ? (
        <DatePicker
          id={controlId}
          value={textValue}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={onChange}
        />
      ) : fieldType === FieldType.Employee ? (
        <Select
          value={textValue || EMPLOYEE_NONE}
          onValueChange={(next) => onChange(next === EMPLOYEE_NONE ? '' : next)}
          disabled={disabled}
        >
          <SelectTrigger id={controlId} className="w-full" aria-invalid={Boolean(error)}>
            <SelectValue placeholder="Не назначен" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EMPLOYEE_NONE}>Не назначен</SelectItem>
            {(employees.data ?? []).map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : fieldType === FieldType.Text ? (
        <Input
          id={controlId}
          value={textValue}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : fieldType === FieldType.Number ? (
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
      ) : fieldType === FieldType.Select ? (
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
      ) : (
        <p className="text-sm text-muted-foreground">Тип поля пока не поддерживается в форме.</p>
      )}

      {error ? <p className={cn('text-sm text-destructive')}>{error}</p> : null}
    </div>
  )
}

function visibleOptions(field: DynamicFieldDefinition, value: DynamicFieldValueData) {
  return field.options.filter((option) => option.isActive || option.code === value)
}
