import { OrderBuiltinField, isOrderBuiltinField } from '@/lib/constants/fields'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import type { OrderDetail } from '../services/orders-service'

export function orderBuiltinValuesFromOrder(order: OrderDetail): Record<string, DynamicFieldValueData> {
  return {
    [OrderBuiltinField.CoverNote]: order.claimedMalfunction,
    [OrderBuiltinField.Completeness]: order.completeness,
    [OrderBuiltinField.Deadline]: order.deadline ?? '',
    [OrderBuiltinField.Responsible]: order.responsibleId ?? '',
  }
}

export function mergeOrderCardValues(
  order: OrderDetail,
  extra: Record<string, DynamicFieldValueData>,
): Record<string, DynamicFieldValueData> {
  return {
    ...extra,
    ...orderBuiltinValuesFromOrder(order),
  }
}

export function splitOrderFieldValues(values: Record<string, DynamicFieldValueData>) {
  const builtin: Record<string, DynamicFieldValueData> = {}
  const extra: Record<string, DynamicFieldValueData> = {}

  for (const [code, value] of Object.entries(values)) {
    if (isOrderBuiltinField(code)) {
      builtin[code] = value
    } else {
      extra[code] = value
    }
  }

  return { builtin, extra }
}

export function asOrderText(value: DynamicFieldValueData | undefined) {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return ''
}

export function orderColumnsFromBuiltin(builtin: Record<string, DynamicFieldValueData>) {
  const deadline = asOrderText(builtin[OrderBuiltinField.Deadline])
  const responsible = asOrderText(builtin[OrderBuiltinField.Responsible])

  return {
    claimedMalfunction: asOrderText(builtin[OrderBuiltinField.CoverNote]),
    completeness: asOrderText(builtin[OrderBuiltinField.Completeness]),
    deadline: deadline || null,
    responsibleId: responsible || null,
  }
}

export function sameOrderDate(left: string | null | undefined, right: string | null | undefined) {
  const a = left?.trim().slice(0, 10) || null
  const b = right?.trim().slice(0, 10) || null
  return a === b
}

export function canEditOrderCardField(
  field: { code: string },
  permissions: { canUpdate: boolean; canAssign: boolean },
) {
  if (field.code === OrderBuiltinField.Responsible) {
    return permissions.canUpdate || permissions.canAssign
  }

  return permissions.canUpdate
}
