import { FieldType, resolvedFieldType } from '@/lib/constants/fields'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { formatDate } from '@/lib/utils/date'

import { formatFieldValue } from '../schemas'
import type { DynamicFieldDefinition, DynamicFieldValueData } from '../services/fields-service'

type DynamicFieldValueProps = {
  field: DynamicFieldDefinition
  value: DynamicFieldValueData
}

export function DynamicFieldValue({ field, value }: DynamicFieldValueProps) {
  const employees = useActiveEmployees()
  const fieldType = resolvedFieldType(field)

  if (fieldType === FieldType.Employee) {
    const id = typeof value === 'string' ? value : ''
    if (!id) {
      return <span>—</span>
    }
    const name = (employees.data ?? []).find((employee) => employee.id === id)?.fullName
    return <span>{name || '—'}</span>
  }

  if (fieldType === FieldType.Date) {
    const text = typeof value === 'string' ? value : ''
    return <span>{text ? formatDate(text) : '—'}</span>
  }

  return <span>{formatFieldValue(field, value)}</span>
}
