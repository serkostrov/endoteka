export const ReferenceSetCode = {
  OrderStatuses: 'order_statuses',
  DeviceGroups: 'device_groups',
  DeviceBrands: 'device_brands',
  DeviceModels: 'device_models',
  DeviceModifications: 'device_modifications',
  InventoryCategories: 'inventory_categories',
  UnitsOfMeasure: 'units_of_measure',
  TaskPriorities: 'task_priorities',
  NotificationEventTypes: 'notification_event_types',
} as const

export type ReferenceSetCode = (typeof ReferenceSetCode)[keyof typeof ReferenceSetCode]
