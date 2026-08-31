export const CLASSIFICATION_NONE = '__none__'

export function emptyToNull(value: string) {
  return !value || value === CLASSIFICATION_NONE ? null : value
}

export function deviceTitle(device: {
  groupName?: string
  brandName?: string
  modelName?: string
  deviceGroup?: string
  deviceBrand?: string
  deviceModel?: string
  label?: string
  deviceLabel?: string
}) {
  const parts = [
    device.groupName ?? device.deviceGroup,
    device.brandName ?? device.deviceBrand,
    device.modelName ?? device.deviceModel,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))

  if (parts.length > 0) {
    return parts.join(' · ')
  }

  const fallback = device.label?.trim() || device.deviceLabel?.trim()
  return fallback || 'Прибор'
}

export function deviceSerialLine(serialNumber: string) {
  const serial = serialNumber.trim()
  return serial ? `Серийный номер: ${serial}` : ''
}

export function classificationLabel(device: {
  groupName: string
  brandName: string
  modelName: string
  modificationName?: string
}) {
  return deviceTitle(device)
}
