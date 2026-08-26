import { FieldType } from '@/lib/constants/fields'

import { formatFieldValue } from '../schemas'
import type { DynamicFieldDefinition, DynamicFieldValueData } from '../services/fields-service'

type DynamicFieldValueProps = {
  field: DynamicFieldDefinition
  value: DynamicFieldValueData
}

export function DynamicFieldValue({ field, value }: DynamicFieldValueProps) {
  if (field.fieldType !== FieldType.Text && field.fieldType !== FieldType.Number && field.fieldType !== FieldType.Select) {
    return <span className="text-muted-foreground">Неподдерживаемый тип</span>
  }

  return <span>{formatFieldValue(field, value)}</span>
}
