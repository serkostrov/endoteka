export type OrderStatusCatalogItem = {
  id: string
  code: string
  name: string
  isActive: boolean
  isSystem: boolean
  sortOrder: number
  groupId: string | null
  groupCode: string | null
  groupName: string | null
  groupSortOrder: number | null
  groupColor: string | null
  color: string | null
  isInitial: boolean
  isTerminal: boolean
  notifiesWarehouse: boolean
  requiresWarranty: boolean
  isDestructive: boolean
}

export type OrderStatusGroup = {
  id: string
  code: string
  name: string
  color: string
  sortOrder: number
  statuses: OrderStatusCatalogItem[]
}

export function groupStatusCatalog(items: OrderStatusCatalogItem[]): OrderStatusGroup[] {
  const groups = new Map<string, OrderStatusGroup>()

  for (const item of items) {
    const key = item.groupId ?? '__other__'
    const current = groups.get(key)
    if (current) {
      current.statuses.push(item)
      continue
    }
    groups.set(key, {
      id: item.groupId ?? key,
      code: item.groupCode ?? 'other',
      name: item.groupName ?? 'Прочие',
      color: item.groupColor ?? item.color ?? '#64748b',
      sortOrder: item.groupSortOrder ?? 999,
      statuses: [item],
    })
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      statuses: [...group.statuses].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ru'),
      ),
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ru'))
}

export function statusBadgeStyle(color: string | null | undefined): { backgroundColor: string; color: string } | undefined {
  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return undefined
  }
  return { backgroundColor: color, color: contrastText(color) }
}

/** Цвет статуса как в меню смены: свой цвет, иначе цвет группы. */
export function statusCatalogBadgeStyle(
  item: Pick<OrderStatusCatalogItem, 'color' | 'groupColor'> | null | undefined,
) {
  return statusBadgeStyle(item?.color || item?.groupColor)
}

export function findStatusCatalogItem(
  catalog: OrderStatusCatalogItem[],
  options: { code?: string | null; name?: string | null },
) {
  const code = options.code?.trim()
  if (code) {
    const byCode = catalog.find((item) => item.code === code)
    if (byCode) {
      return byCode
    }
  }
  const name = options.name?.trim()
  if (!name) {
    return undefined
  }
  return catalog.find((item) => item.name === name)
}

export function mergeStatusGroups(
  items: OrderStatusCatalogItem[],
  groups: { id: string; code: string; name: string; color: string; sortOrder: number }[],
): OrderStatusGroup[] {
  const byId = new Map(groupStatusCatalog(items).map((group) => [group.id, group]))

  for (const group of groups) {
    if (byId.has(group.id)) {
      continue
    }
    byId.set(group.id, {
      id: group.id,
      code: group.code,
      name: group.name,
      color: group.color,
      sortOrder: group.sortOrder,
      statuses: [],
    })
  }

  return [...byId.values()].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ru'),
  )
}

export function isClosedStatusGroup(statuses: Pick<OrderStatusCatalogItem, 'isTerminal'>[]) {
  return statuses.length > 0 && statuses.every((item) => item.isTerminal)
}

/** Группы, где срок ремонта уже не актуален: готовые и закрытые. Значение в БД не трогаем — только UI. */
export function hidesOrderDeadline(groupCode: string | null | undefined) {
  return groupCode === 'ready' || groupCode === 'closed_ok' || groupCode === 'closed_fail'
}

export function statusCodesHidingDeadline(
  catalog: Pick<OrderStatusCatalogItem, 'code' | 'groupCode'>[],
) {
  const codes = new Set<string>()
  for (const item of catalog) {
    if (hidesOrderDeadline(item.groupCode)) {
      codes.add(item.code)
    }
  }
  return codes
}

export function hexToRgba(color: string, alpha: number) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return undefined
  }
  const value = Number.parseInt(color.slice(1), 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function contrastText(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance > 160 ? '#111827' : '#ffffff'
}
