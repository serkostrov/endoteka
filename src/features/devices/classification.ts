export const CLASSIFICATION_NONE = '__none__'

export function emptyToNull(value: string) {
  return !value || value === CLASSIFICATION_NONE ? null : value
}

export function classificationLabel(device: {
  groupName: string
  brandName: string
  modelName: string
  modificationName: string
}) {
  return (
    [device.groupName, device.brandName, device.modelName, device.modificationName].filter(Boolean).join(' · ') ||
    'Классификация не указана'
  )
}
