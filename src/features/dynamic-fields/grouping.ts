import type { DynamicFieldDefinition } from './services/fields-service'

export type DynamicFieldGroup = {
  name: string
  fields: DynamicFieldDefinition[]
}

export function groupDynamicFields(fields: DynamicFieldDefinition[]): DynamicFieldGroup[] {
  const byName = new Map<string, DynamicFieldDefinition[]>()

  for (const field of fields) {
    const name = field.groupName.trim() || 'Прочие поля'
    const list = byName.get(name) ?? []
    list.push(field)
    byName.set(name, list)
  }

  return [...byName.entries()]
    .map(([name, groupFields]) => ({
      name,
      fields: [...groupFields].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ru'),
      ),
    }))
    .sort((left, right) => {
      const leftOrder = Math.min(...left.fields.map((field) => field.sortOrder))
      const rightOrder = Math.min(...right.fields.map((field) => field.sortOrder))
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }
      return left.name.localeCompare(right.name, 'ru')
    })
}
