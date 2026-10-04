import { pick } from './csv.ts'
import { payloadHash } from './hash.ts'
import { identityFromSourceId, resolveIdentity, slugCode } from './keys.ts'
import { missingIfEmpty, parseBoolean, parseDate, parseDateTime, parseNumber } from './normalize.ts'
import type { ImportStore } from './store.ts'
import type { CsvRow, DatasetId, ItemRecord, RowOutcome } from './types.ts'
import { DatasetId as Dataset } from './types.ts'

export type HandlerContext = {
  store: ImportStore
  runId: string
  dryRun: boolean
  relatedRows?: Partial<Record<DatasetId, CsvRow[]>>
}

function fail(dataset: DatasetId, rowNumber: number, row: CsvRow, message: string, extra?: Partial<RowOutcome>): RowOutcome {
  return {
    dataset,
    rowNumber,
    sourceKey: extra?.sourceKey ?? null,
    status: 'failed',
    missingFields: extra?.missingFields ?? [],
    errorCode: extra?.errorCode ?? 'invalid_row',
    errorMessage: message,
    payload: row,
  }
}

function ok(
  dataset: DatasetId,
  rowNumber: number,
  row: CsvRow,
  status: 'created' | 'updated' | 'skipped',
  extra: Partial<RowOutcome>,
): RowOutcome {
  return {
    dataset,
    rowNumber,
    sourceKey: extra.sourceKey ?? null,
    status,
    entityType: extra.entityType,
    entityId: extra.entityId,
    missingFields: extra.missingFields ?? [],
    errorMessage: extra.errorMessage,
    payload: row,
  }
}

async function persistKey(
  ctx: HandlerContext,
  record: { dataset: string; sourceKey: string; entityType: string; entityId: string; payloadHash: string },
) {
  if (!ctx.dryRun) {
    await ctx.store.putSourceKey(record, ctx.runId)
  }
}

async function resolveMapped(
  store: ImportStore,
  dataset: DatasetId,
  sourceId: string,
): Promise<string | null> {
  const key = identityFromSourceId(dataset, sourceId)
  if (!key) {
    return null
  }
  const mapped = await store.getSourceKey(dataset, key)
  return mapped?.entityId ?? null
}

async function resolveItem(store: ImportStore, row: CsvRow): Promise<ItemRecord | null> {
  const mappedId = await resolveMapped(store, Dataset.WarehouseItems, pick(row, 'item_source_id'))
  if (mappedId) {
    return store.findItemById(mappedId)
  }
  const code = pick(row, 'item_code')
  if (code) {
    return store.findItemByCode(code)
  }
  return null
}

export async function handleEmployees(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const sourceId = pick(row, 'source_id')
  const email = pick(row, 'email').toLowerCase()
  const fullName = pick(row, 'full_name')
  const roleCode = pick(row, 'role_code')
  const activeRaw = parseBoolean(pick(row, 'is_active'))
  const identity = resolveIdentity(Dataset.Employees, pick(row, 'source_id'), [{ label: 'email', value: email }])
  if ('error' in identity) {
    return fail(Dataset.Employees, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (!email) {
    return fail(Dataset.Employees, rowNumber, row, 'Сотрудника нельзя импортировать без email.', {
      sourceKey: identity.key,
      errorCode: 'no_identity',
    })
  }
  if (!fullName) {
    return fail(Dataset.Employees, rowNumber, row, 'Укажите ФИО сотрудника.', { sourceKey: identity.key })
  }
  if (!roleCode) {
    return fail(Dataset.Employees, rowNumber, row, 'Укажите код роли.', { sourceKey: identity.key })
  }
  const role = await ctx.store.findRole(roleCode)
  if (!role) {
    return fail(Dataset.Employees, rowNumber, row, `Неизвестная роль: ${roleCode}.`, { sourceKey: identity.key })
  }

  const isActive = activeRaw ?? true
  const missingFields = missingIfEmpty({
    source_id: sourceId,
    is_active: pick(row, 'is_active'),
  })
  const normalized = { email, fullName, roleCode, isActive }
  const hash = payloadHash(normalized)
  const existingKey = await ctx.store.getSourceKey(Dataset.Employees, identity.key)
  if (existingKey?.payloadHash === hash) {
    return ok(Dataset.Employees, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'user',
      entityId: existingKey.entityId,
      missingFields,
    })
  }

  if (ctx.dryRun) {
    return ok(Dataset.Employees, rowNumber, row, existingKey ? 'updated' : 'created', {
      sourceKey: identity.key,
      entityType: 'user',
      entityId: existingKey?.entityId,
      missingFields,
    })
  }

  const result = await ctx.store.upsertEmployee({
    id: existingKey?.entityId,
    ...normalized,
  })
  await persistKey(ctx, {
    dataset: Dataset.Employees,
    sourceKey: identity.key,
    entityType: 'user',
    entityId: result.record.id,
    payloadHash: hash,
  })
  return ok(Dataset.Employees, rowNumber, row, result.created ? 'created' : 'updated', {
    sourceKey: identity.key,
    entityType: 'user',
    entityId: result.record.id,
    missingFields,
  })
}

export async function handleCustomers(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const name = pick(row, 'name')
  const kindRaw = pick(row, 'kind').toLowerCase()
  const inn = pick(row, 'inn')
  const email = pick(row, 'email').toLowerCase()
  const identity = inn
    ? resolveIdentity(Dataset.Customers, pick(row, 'source_id'), [{ label: 'inn', value: inn }])
    : resolveIdentity(Dataset.Customers, pick(row, 'source_id'), [{ label: 'email', value: email }])
  if ('error' in identity) {
    return fail(Dataset.Customers, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (!name) {
    return fail(Dataset.Customers, rowNumber, row, 'Укажите название или ФИО клиента.', { sourceKey: identity.key })
  }

  let kind = kindRaw || 'organization'
  if (kind === 'организация') {
    kind = 'organization'
  }
  if (kind === 'физлицо' || kind === 'ип' || kind === 'individual') {
    kind = 'individual'
  }
  if (kind !== 'organization' && kind !== 'individual') {
    return fail(Dataset.Customers, rowNumber, row, 'Неизвестный тип клиента.', { sourceKey: identity.key })
  }

  const record = {
    name,
    kind,
    inn,
    kpp: pick(row, 'kpp'),
    ogrn: pick(row, 'ogrn'),
    phone: pick(row, 'phone'),
    email,
    city: pick(row, 'city'),
    contactName: pick(row, 'contact_name'),
    notes: pick(row, 'notes'),
  }
  const missingFields = missingIfEmpty({
    source_id: pick(row, 'source_id'),
    kind: pick(row, 'kind'),
    inn,
    email,
    phone: record.phone,
  })
  const hash = payloadHash(record)
  const existingKey = await ctx.store.getSourceKey(Dataset.Customers, identity.key)
  if (existingKey?.payloadHash === hash) {
    return ok(Dataset.Customers, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'customer',
      entityId: existingKey.entityId,
      missingFields,
    })
  }

  if (ctx.dryRun) {
    return ok(Dataset.Customers, rowNumber, row, existingKey ? 'updated' : 'created', {
      sourceKey: identity.key,
      entityType: 'customer',
      entityId: existingKey?.entityId,
      missingFields,
    })
  }

  try {
    const result = await ctx.store.upsertCustomer({ id: existingKey?.entityId, ...record })
    await persistKey(ctx, {
      dataset: Dataset.Customers,
      sourceKey: identity.key,
      entityType: 'customer',
      entityId: result.record.id,
      payloadHash: hash,
    })
    return ok(Dataset.Customers, rowNumber, row, result.created ? 'created' : 'updated', {
      sourceKey: identity.key,
      entityType: 'customer',
      entityId: result.record.id,
      missingFields,
    })
  } catch (error) {
    return fail(Dataset.Customers, rowNumber, row, error instanceof Error ? error.message : 'Ошибка клиента.', {
      sourceKey: identity.key,
    })
  }
}

export async function handleDeviceModels(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const groupName = pick(row, 'group_name')
  const brandName = pick(row, 'brand_name')
  const modelName = pick(row, 'model_name')
  const groupCode = slugCode(pick(row, 'group_code') || groupName)
  const brandCode = slugCode(pick(row, 'brand_code') || brandName)
  const modelCode = slugCode(pick(row, 'model_code') || modelName)
  const modificationName = pick(row, 'modification_name')
  const modificationCode = slugCode(pick(row, 'modification_code') || modificationName)

  const identity = resolveIdentity(Dataset.DeviceModels, pick(row, 'source_id'), [
    { label: 'group_code', value: groupCode },
    { label: 'brand_code', value: brandCode },
    { label: 'model_code', value: modelCode },
  ])
  if ('error' in identity) {
    return fail(Dataset.DeviceModels, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (!groupName || !brandName || !modelName || !groupCode || !brandCode || !modelCode) {
    return fail(Dataset.DeviceModels, rowNumber, row, 'Нужны группа, бренд и модель.', { sourceKey: identity.key })
  }

  const missingFields = missingIfEmpty({
    source_id: pick(row, 'source_id'),
    modification_name: modificationName,
  })
  // v2: upsert matches by (parent, name) so the same brand can live under many groups.
  const hash = payloadHash({
    groupCode,
    brandCode,
    modelCode,
    modificationCode,
    groupName,
    brandName,
    modelName,
    modificationName,
    linkByParentName: true,
  })
  const existingKey = await ctx.store.getSourceKey(Dataset.DeviceModels, identity.key)
  if (existingKey?.payloadHash === hash) {
    return ok(Dataset.DeviceModels, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'reference_item',
      entityId: existingKey.entityId,
      missingFields,
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.DeviceModels, rowNumber, row, existingKey ? 'updated' : 'created', {
      sourceKey: identity.key,
      entityType: 'reference_item',
      missingFields,
    })
  }

  const group = await ctx.store.upsertReference({
    setCode: 'device_groups',
    code: groupCode,
    name: groupName,
    parentId: null,
  })
  const brand = await ctx.store.upsertReference({
    setCode: 'device_brands',
    code: brandCode,
    name: brandName,
    parentId: group.record.id,
  })
  const model = await ctx.store.upsertReference({
    setCode: 'device_models',
    code: modelCode,
    name: modelName,
    parentId: brand.record.id,
  })
  let leaf = model
  if (modificationCode && modificationName) {
    leaf = await ctx.store.upsertReference({
      setCode: 'device_modifications',
      code: modificationCode,
      name: modificationName,
      parentId: model.record.id,
    })
  }
  await persistKey(ctx, {
    dataset: Dataset.DeviceModels,
    sourceKey: identity.key,
    entityType: 'reference_item',
    entityId: leaf.record.id,
    payloadHash: hash,
  })
  const created = group.created || brand.created || model.created || leaf.created
  return ok(Dataset.DeviceModels, rowNumber, row, created ? 'created' : 'updated', {
    sourceKey: identity.key,
    entityType: 'reference_item',
    entityId: leaf.record.id,
    missingFields,
  })
}

export async function handleWarehouseItems(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const code = pick(row, 'code')
  const name = pick(row, 'name')
  const identity = resolveIdentity(Dataset.WarehouseItems, pick(row, 'source_id'), [{ label: 'code', value: code }])
  if ('error' in identity) {
    return fail(Dataset.WarehouseItems, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (!name) {
    return fail(Dataset.WarehouseItems, rowNumber, row, 'Укажите название номенклатуры.', { sourceKey: identity.key })
  }
  const categoryCode = slugCode(pick(row, 'category_code'))
  const categoryName = pick(row, 'category_name') || pick(row, 'category_code') || categoryCode
  const unitCode = slugCode(pick(row, 'unit_code'))
  if (!categoryCode || !unitCode) {
    return fail(Dataset.WarehouseItems, rowNumber, row, 'Укажите категорию и единицу измерения.', {
      sourceKey: identity.key,
    })
  }
  const unit = await ctx.store.findReference('units_of_measure', unitCode)
  if (!unit) {
    return fail(Dataset.WarehouseItems, rowNumber, row, 'Единица измерения не найдена в справочнике.', {
      sourceKey: identity.key,
    })
  }

  const purchasePrice = parseNumber(pick(row, 'purchase_price')) ?? 0
  const repairPrice = parseNumber(pick(row, 'repair_price')) ?? 0
  const retailPrice = parseNumber(pick(row, 'retail_price')) ?? 0
  if (purchasePrice < 0 || repairPrice < 0 || retailPrice < 0) {
    return fail(Dataset.WarehouseItems, rowNumber, row, 'Цена не может быть отрицательной.', { sourceKey: identity.key })
  }

  const missingFields = missingIfEmpty({
    source_id: pick(row, 'source_id'),
    article: pick(row, 'article'),
    barcode: pick(row, 'barcode'),
    category_name: pick(row, 'category_name'),
    purchase_price: pick(row, 'purchase_price'),
    repair_price: pick(row, 'repair_price'),
    retail_price: pick(row, 'retail_price'),
  })
  const hash = payloadHash({
    code,
    name,
    article: pick(row, 'article'),
    barcode: pick(row, 'barcode'),
    categoryCode,
    categoryName,
    unitCode,
    purchasePrice,
    repairPrice,
    retailPrice,
  })
  const existingKey = await ctx.store.getSourceKey(Dataset.WarehouseItems, identity.key)
  if (existingKey?.payloadHash === hash) {
    return ok(Dataset.WarehouseItems, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'inventory_item',
      entityId: existingKey.entityId,
      missingFields,
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.WarehouseItems, rowNumber, row, existingKey ? 'updated' : 'created', {
      sourceKey: identity.key,
      entityType: 'inventory_item',
      missingFields,
    })
  }
  try {
    const category = await ctx.store.upsertReference({
      setCode: 'inventory_categories',
      code: categoryCode,
      name: categoryName,
      parentId: null,
    })
    const record = {
      code,
      name,
      article: pick(row, 'article'),
      barcode: pick(row, 'barcode'),
      categoryId: category.record.id,
      unitId: unit.id,
      purchasePrice,
      repairPrice,
      retailPrice,
    }
    const result = await ctx.store.upsertItem({ id: existingKey?.entityId, ...record })
    await persistKey(ctx, {
      dataset: Dataset.WarehouseItems,
      sourceKey: identity.key,
      entityType: 'inventory_item',
      entityId: result.record.id,
      payloadHash: hash,
    })
    return ok(Dataset.WarehouseItems, rowNumber, row, result.created ? 'created' : 'updated', {
      sourceKey: identity.key,
      entityType: 'inventory_item',
      entityId: result.record.id,
      missingFields,
    })
  } catch (error) {
    return fail(Dataset.WarehouseItems, rowNumber, row, error instanceof Error ? error.message : 'Ошибка номенклатуры.', {
      sourceKey: identity.key,
    })
  }
}

export async function handleBarcodes(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const barcode = pick(row, 'barcode')
  const identity = resolveIdentity(Dataset.Barcodes, pick(row, 'source_id'), [
    { label: 'item_source_id|item_code', value: pick(row, 'item_source_id') || pick(row, 'item_code') },
    { label: 'barcode', value: barcode },
  ])
  if ('error' in identity) {
    return fail(Dataset.Barcodes, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (!barcode) {
    return fail(Dataset.Barcodes, rowNumber, row, 'Укажите штрихкод.', { sourceKey: identity.key })
  }
  const item = await resolveItem(ctx.store, row)
  if (!item) {
    return fail(Dataset.Barcodes, rowNumber, row, 'Номенклатура для штрихкода не найдена.', { sourceKey: identity.key })
  }
  const hash = payloadHash({ itemId: item.id, barcode })
  const existingKey = await ctx.store.getSourceKey(Dataset.Barcodes, identity.key)
  if (existingKey?.payloadHash === hash) {
    return ok(Dataset.Barcodes, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'inventory_item',
      entityId: item.id,
      missingFields: [],
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.Barcodes, rowNumber, row, 'updated', { sourceKey: identity.key, entityType: 'inventory_item' })
  }
  const result = await ctx.store.upsertItem({ ...item, barcode })
  await persistKey(ctx, {
    dataset: Dataset.Barcodes,
    sourceKey: identity.key,
    entityType: 'inventory_item',
    entityId: result.record.id,
    payloadHash: hash,
  })
  return ok(Dataset.Barcodes, rowNumber, row, 'updated', {
    sourceKey: identity.key,
    entityType: 'inventory_item',
    entityId: result.record.id,
    missingFields: [],
  })
}

export async function handlePrices(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const item = await resolveItem(ctx.store, row)
  const identity = resolveIdentity(Dataset.Prices, pick(row, 'source_id'), [
    { label: 'item_source_id|item_code', value: pick(row, 'item_source_id') || pick(row, 'item_code') },
  ])
  if ('error' in identity) {
    return fail(Dataset.Prices, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (!item) {
    return fail(Dataset.Prices, rowNumber, row, 'Номенклатура для цены не найдена.', { sourceKey: identity.key })
  }
  const purchasePrice = parseNumber(pick(row, 'purchase_price'))
  const repairPrice = parseNumber(pick(row, 'repair_price'))
  const retailPrice = parseNumber(pick(row, 'retail_price'))
  if (purchasePrice === null && repairPrice === null && retailPrice === null) {
    return fail(Dataset.Prices, rowNumber, row, 'Нет ни одной цены.', { sourceKey: identity.key })
  }
  const next = {
    ...item,
    purchasePrice: purchasePrice ?? item.purchasePrice,
    repairPrice: repairPrice ?? item.repairPrice,
    retailPrice: retailPrice ?? item.retailPrice,
  }
  const missingFields = missingIfEmpty({
    purchase_price: pick(row, 'purchase_price'),
    repair_price: pick(row, 'repair_price'),
    retail_price: pick(row, 'retail_price'),
  })
  const hash = payloadHash({
    itemId: item.id,
    purchasePrice: next.purchasePrice,
    repairPrice: next.repairPrice,
    retailPrice: next.retailPrice,
  })
  const existingKey = await ctx.store.getSourceKey(Dataset.Prices, identity.key)
  if (existingKey?.payloadHash === hash) {
    return ok(Dataset.Prices, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'inventory_item',
      entityId: item.id,
      missingFields,
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.Prices, rowNumber, row, 'updated', { sourceKey: identity.key, missingFields })
  }
  const result = await ctx.store.upsertItem(next)
  await persistKey(ctx, {
    dataset: Dataset.Prices,
    sourceKey: identity.key,
    entityType: 'inventory_item',
    entityId: result.record.id,
    payloadHash: hash,
  })
  return ok(Dataset.Prices, rowNumber, row, 'updated', {
    sourceKey: identity.key,
    entityType: 'inventory_item',
    entityId: result.record.id,
    missingFields,
  })
}

export async function handleWarehouseStock(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const quantity = parseNumber(pick(row, 'quantity'))
  const identity = resolveIdentity(Dataset.WarehouseStock, pick(row, 'source_id'), [
    { label: 'item_source_id|item_code', value: pick(row, 'item_source_id') || pick(row, 'item_code') },
    { label: 'receipt_date', value: pick(row, 'receipt_date') },
    { label: 'supplier', value: pick(row, 'supplier') },
    { label: 'quantity', value: pick(row, 'quantity') },
  ])
  if ('error' in identity) {
    return fail(Dataset.WarehouseStock, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (quantity === null || quantity <= 0) {
    return fail(Dataset.WarehouseStock, rowNumber, row, 'Количество прихода должно быть больше нуля.', {
      sourceKey: identity.key,
    })
  }
  const receiptDate = parseDate(pick(row, 'receipt_date'))
  if (!receiptDate) {
    return fail(Dataset.WarehouseStock, rowNumber, row, 'Укажите дату прихода.', { sourceKey: identity.key })
  }
  const supplier = pick(row, 'supplier')
  if (!supplier) {
    return fail(Dataset.WarehouseStock, rowNumber, row, 'Укажите поставщика.', { sourceKey: identity.key })
  }
  const item = await resolveItem(ctx.store, row)
  if (!item) {
    return fail(Dataset.WarehouseStock, rowNumber, row, 'Номенклатура для остатка не найдена.', { sourceKey: identity.key })
  }
  const purchasePrice = parseNumber(pick(row, 'purchase_price')) ?? item.purchasePrice
  const missingFields = missingIfEmpty({ source_id: pick(row, 'source_id'), purchase_price: pick(row, 'purchase_price') })
  const hash = payloadHash({ itemId: item.id, quantity, purchasePrice, supplier, receiptDate })
  const existingKey = await ctx.store.getSourceKey(Dataset.WarehouseStock, identity.key)
  if (existingKey) {
    return ok(Dataset.WarehouseStock, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'inventory_receipt',
      entityId: existingKey.entityId,
      missingFields,
      errorMessage: existingKey.payloadHash === hash ? undefined : 'Приход уже загружен и не изменяется.',
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.WarehouseStock, rowNumber, row, 'created', { sourceKey: identity.key, missingFields })
  }
  const created = await ctx.store.createStockReceipt({
    itemId: item.id,
    quantity,
    purchasePrice,
    supplier,
    receiptDate,
  })
  await persistKey(ctx, {
    dataset: Dataset.WarehouseStock,
    sourceKey: identity.key,
    entityType: 'inventory_receipt',
    entityId: created.receiptId,
    payloadHash: hash,
  })
  return ok(Dataset.WarehouseStock, rowNumber, row, 'created', {
    sourceKey: identity.key,
    entityType: 'inventory_receipt',
    entityId: created.receiptId,
    missingFields,
  })
}

export async function handleOrders(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const number = pick(row, 'number')
  const serial = pick(row, 'serial_number')
  const identity = resolveIdentity(Dataset.Orders, pick(row, 'source_id'), [{ label: 'number', value: number }])
  if ('error' in identity) {
    return fail(Dataset.Orders, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (!serial) {
    return fail(Dataset.Orders, rowNumber, row, 'У заказа нет серийного номера прибора — запись пропущена без выдумывания данных.', {
      sourceKey: identity.key,
    })
  }

  const customerId =
    (await resolveMapped(ctx.store, Dataset.Customers, pick(row, 'customer_source_id'))) ??
    (pick(row, 'customer_inn') ? (await ctx.store.findCustomerByInn(pick(row, 'customer_inn')))?.id : null)
  if (!customerId) {
    return fail(Dataset.Orders, rowNumber, row, 'Клиент заказа не найден. Связь не создаётся наугад.', {
      sourceKey: identity.key,
    })
  }

  const statusCode = slugCode(pick(row, 'status_code'))
  const status = statusCode ? await ctx.store.findStatus(statusCode) : null
  if (!status) {
    return fail(Dataset.Orders, rowNumber, row, 'Статус заказа неизвестен. Подставлять начальный статус нельзя.', {
      sourceKey: identity.key,
    })
  }

  let responsibleId: string | null = null
  const employeeMapped = await resolveMapped(ctx.store, Dataset.Employees, pick(row, 'employee_source_id'))
  if (employeeMapped) {
    responsibleId = employeeMapped
  } else if (pick(row, 'employee_email')) {
    const employee = await ctx.store.findEmployeeByEmail(pick(row, 'employee_email').toLowerCase())
    responsibleId = employee?.id ?? null
    if (!employee) {
      return fail(Dataset.Orders, rowNumber, row, 'Ответственный сотрудник не найден.', { sourceKey: identity.key })
    }
  }

  let groupId: string | null = null
  let brandId: string | null = null
  let modelId: string | null = null
  let modificationId: string | null = null
  if (pick(row, 'model_source_id')) {
    const mappedModelId = await resolveMapped(ctx.store, Dataset.DeviceModels, pick(row, 'model_source_id'))
    const ref = mappedModelId ? await ctx.store.findReferenceById(mappedModelId) : null
    if (!ref) {
      return fail(Dataset.Orders, rowNumber, row, 'Модель прибора из источника не найдена.', { sourceKey: identity.key })
    }
    if (ref.setCode === 'device_modifications') {
      modificationId = ref.id
      modelId = ref.parentId
      const model = modelId ? await ctx.store.findReferenceById(modelId) : null
      brandId = model?.parentId ?? null
    } else if (ref.setCode === 'device_models') {
      modelId = ref.id
      brandId = ref.parentId
    }
    const brand = brandId ? await ctx.store.findReferenceById(brandId) : null
    groupId = brand?.parentId ?? null
  }

  const deviceResult = ctx.dryRun
    ? { record: { id: (await ctx.store.findDeviceBySerial(serial))?.id ?? 'preview' }, created: false }
    : await ctx.store.upsertDevice({
        serialNumber: serial,
        customerId,
        groupId,
        brandId,
        modelId,
        modificationId,
      })

  const claimed = pick(row, 'claimed_malfunction')
  const completeness = pick(row, 'completeness')
  const externalCondition = pick(row, 'external_condition')
  const deadline = parseDate(pick(row, 'deadline'))
  const createdAt = parseDateTime(pick(row, 'created_at')) ?? new Date().toISOString()
  const missingFields = missingIfEmpty({
    source_id: pick(row, 'source_id'),
    claimed_malfunction: claimed,
    completeness,
    external_condition: externalCondition,
    deadline: pick(row, 'deadline'),
    employee_source_id: pick(row, 'employee_source_id') || pick(row, 'employee_email'),
    model_source_id: pick(row, 'model_source_id'),
    created_at: pick(row, 'created_at'),
  })

  const payload = {
    number,
    customerId,
    deviceId: deviceResult.record.id,
    serial,
    claimed,
    completeness,
    externalCondition,
    deadline,
    responsibleId,
    statusId: status.id,
  }
  const hash = payloadHash(payload)
  const existingKey = await ctx.store.getSourceKey(Dataset.Orders, identity.key)
  if (existingKey?.payloadHash === hash) {
    return ok(Dataset.Orders, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'order',
      entityId: existingKey.entityId,
      missingFields,
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.Orders, rowNumber, row, existingKey ? 'updated' : 'created', {
      sourceKey: identity.key,
      missingFields,
    })
  }

  const digits = number.match(/(\d+)\s*$/)
  const numberSeq = digits ? Number(digits[1]) : 0
  const result = await ctx.store.upsertOrder({
    id: existingKey?.entityId,
    number,
    numberSeq,
    customerId,
    deviceId: deviceResult.record.id,
    serialNumber: serial,
    claimedMalfunction: claimed,
    completeness,
    externalCondition,
    deadline,
    responsibleId,
    statusId: status.id,
    createdAt,
  })
  if (numberSeq > 0) {
    await ctx.store.bumpOrderSequence(numberSeq)
  }
  await persistKey(ctx, {
    dataset: Dataset.Orders,
    sourceKey: identity.key,
    entityType: 'order',
    entityId: result.record.id,
    payloadHash: hash,
  })
  return ok(Dataset.Orders, rowNumber, row, result.created ? 'created' : 'updated', {
    sourceKey: identity.key,
    entityType: 'order',
    entityId: result.record.id,
    missingFields,
  })
}

export async function handleOrderConsumption(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const quantity = parseNumber(pick(row, 'quantity'))
  const identity = resolveIdentity(Dataset.OrderConsumption, pick(row, 'source_id'), [
    { label: 'order_source_id|order_number', value: pick(row, 'order_source_id') || pick(row, 'order_number') },
    { label: 'item_source_id|item_code', value: pick(row, 'item_source_id') || pick(row, 'item_code') },
    { label: 'quantity', value: pick(row, 'quantity') },
  ])
  if ('error' in identity) {
    return fail(Dataset.OrderConsumption, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (quantity === null || quantity <= 0) {
    return fail(Dataset.OrderConsumption, rowNumber, row, 'Количество списания должно быть больше нуля.', {
      sourceKey: identity.key,
    })
  }

  const orderId =
    (await resolveMapped(ctx.store, Dataset.Orders, pick(row, 'order_source_id'))) ??
    (pick(row, 'order_number') ? (await ctx.store.findOrderByNumber(pick(row, 'order_number')))?.id : null)
  if (!orderId) {
    return fail(Dataset.OrderConsumption, rowNumber, row, 'Заказ для списания не найден. Связь не создаётся наугад.', {
      sourceKey: identity.key,
    })
  }
  const item = await resolveItem(ctx.store, row)
  if (!item) {
    return fail(Dataset.OrderConsumption, rowNumber, row, 'Номенклатура для списания не найдена.', { sourceKey: identity.key })
  }

  const unitPrice = parseNumber(pick(row, 'unit_price'))
  const missingFields = missingIfEmpty({ source_id: pick(row, 'source_id'), unit_price: pick(row, 'unit_price') })
  const hash = payloadHash({ orderId, itemId: item.id, quantity, unitPrice })
  const existingKey = await ctx.store.getSourceKey(Dataset.OrderConsumption, identity.key)
  if (existingKey) {
    return ok(Dataset.OrderConsumption, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'inventory_movement',
      entityId: existingKey.entityId,
      missingFields,
      errorMessage: existingKey.payloadHash === hash ? undefined : 'Списание уже загружено и не изменяется.',
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.OrderConsumption, rowNumber, row, 'created', { sourceKey: identity.key, missingFields })
  }

  try {
    const consumed = await ctx.store.consumeForOrder({
      orderId,
      itemId: item.id,
      quantity,
      unitPrice,
    })
    const entityId = consumed.movementIds[0] ?? orderId
    await persistKey(ctx, {
      dataset: Dataset.OrderConsumption,
      sourceKey: identity.key,
      entityType: 'inventory_movement',
      entityId,
      payloadHash: hash,
    })
    return ok(Dataset.OrderConsumption, rowNumber, row, 'created', {
      sourceKey: identity.key,
      entityType: 'inventory_movement',
      entityId,
      missingFields,
    })
  } catch (error) {
    return fail(Dataset.OrderConsumption, rowNumber, row, error instanceof Error ? error.message : 'Ошибка списания.', {
      sourceKey: identity.key,
      missingFields,
    })
  }
}

function linesForParent(
  ctx: HandlerContext,
  satellite: DatasetId,
  parentField: string,
  parentSourceId: string,
): CsvRow[] {
  const rows = ctx.relatedRows?.[satellite] ?? []
  return rows.filter((row) => pick(row, parentField) === parentSourceId)
}

export async function handleReceipts(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const sourceId = pick(row, 'source_id')
  const identity = resolveIdentity(Dataset.Receipts, sourceId, [
    { label: 'receipt_date', value: pick(row, 'receipt_date') },
    { label: 'supplier', value: pick(row, 'supplier') },
  ])
  if ('error' in identity) {
    return fail(Dataset.Receipts, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  const receiptDate = parseDate(pick(row, 'receipt_date'))
  if (!receiptDate) {
    return fail(Dataset.Receipts, rowNumber, row, 'Укажите дату прихода.', { sourceKey: identity.key })
  }
  const supplier = pick(row, 'supplier') || 'Поставщик RO App'
  const notes = pick(row, 'notes')
  const supplierId =
    (await resolveMapped(ctx.store, Dataset.Customers, pick(row, 'supplier_source_id'))) ?? null
  const lineRows = linesForParent(ctx, Dataset.ReceiptLines, 'receipt_source_id', sourceId)
  if (lineRows.length === 0) {
    return fail(Dataset.Receipts, rowNumber, row, 'Нет строк прихода.', { sourceKey: identity.key })
  }

  const lines: Array<{ itemId: string; quantity: number; purchasePrice: number }> = []
  for (const [index, line] of lineRows.entries()) {
    const quantity = parseNumber(pick(line, 'quantity'))
    if (quantity === null || quantity <= 0) {
      return fail(Dataset.Receipts, rowNumber, row, `Строка ${index + 1}: количество должно быть больше нуля.`, {
        sourceKey: identity.key,
      })
    }
    const item = await resolveItem(ctx.store, line)
    if (!item) {
      return fail(
        Dataset.Receipts,
        rowNumber,
        row,
        `Строка ${index + 1}: номенклатура не найдена (${pick(line, 'item_source_id') || pick(line, 'item_code') || '—'}).`,
        { sourceKey: identity.key },
      )
    }
    const purchasePrice = parseNumber(pick(line, 'purchase_price')) ?? item.purchasePrice
    if (purchasePrice < 0) {
      return fail(Dataset.Receipts, rowNumber, row, `Строка ${index + 1}: цена закупки не может быть отрицательной.`, {
        sourceKey: identity.key,
      })
    }
    lines.push({ itemId: item.id, quantity, purchasePrice })
  }

  const hash = payloadHash({ supplier, supplierId, receiptDate, notes, lines })
  const existingKey = await ctx.store.getSourceKey(Dataset.Receipts, identity.key)
  if (existingKey) {
    return ok(Dataset.Receipts, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'inventory_receipt',
      entityId: existingKey.entityId,
      missingFields: [],
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.Receipts, rowNumber, row, 'created', { sourceKey: identity.key, missingFields: [] })
  }
  try {
    const created = await ctx.store.createImportedReceipt({
      supplier,
      supplierId,
      receiptDate,
      notes: notes || 'Импорт прихода RO App',
      lines,
    })
    await persistKey(ctx, {
      dataset: Dataset.Receipts,
      sourceKey: identity.key,
      entityType: 'inventory_receipt',
      entityId: created.receiptId,
      payloadHash: hash,
    })
    return ok(Dataset.Receipts, rowNumber, row, 'created', {
      sourceKey: identity.key,
      entityType: 'inventory_receipt',
      entityId: created.receiptId,
      missingFields: [],
    })
  } catch (error) {
    return fail(Dataset.Receipts, rowNumber, row, error instanceof Error ? error.message : 'Ошибка прихода.', {
      sourceKey: identity.key,
    })
  }
}

export async function handleWriteOffs(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const sourceId = pick(row, 'source_id')
  const identity = resolveIdentity(Dataset.WriteOffs, sourceId, [
    { label: 'write_off_date', value: pick(row, 'write_off_date') },
    { label: 'reason', value: pick(row, 'reason') },
  ])
  if ('error' in identity) {
    return fail(Dataset.WriteOffs, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  const writeOffDate = parseDate(pick(row, 'write_off_date'))
  if (!writeOffDate) {
    return fail(Dataset.WriteOffs, rowNumber, row, 'Укажите дату списания.', { sourceKey: identity.key })
  }
  const reason = pick(row, 'reason') || 'Списание RO App'
  const notes = pick(row, 'notes')
  const lineRows = linesForParent(ctx, Dataset.WriteOffLines, 'write_off_source_id', sourceId)
  if (lineRows.length === 0) {
    return fail(Dataset.WriteOffs, rowNumber, row, 'Нет строк списания.', { sourceKey: identity.key })
  }

  const lines: Array<{ itemId: string; quantity: number; unitCost: number }> = []
  for (const line of lineRows) {
    const quantity = parseNumber(pick(line, 'quantity'))
    if (quantity === null || quantity <= 0) {
      return fail(Dataset.WriteOffs, rowNumber, row, 'В строке списания количество должно быть больше нуля.', {
        sourceKey: identity.key,
      })
    }
    const item = await resolveItem(ctx.store, line)
    if (!item) {
      return fail(Dataset.WriteOffs, rowNumber, row, 'Номенклатура строки списания не найдена.', {
        sourceKey: identity.key,
      })
    }
    lines.push({ itemId: item.id, quantity, unitCost: item.purchasePrice })
  }

  const hash = payloadHash({ writeOffDate, reason, notes, lines })
  const existingKey = await ctx.store.getSourceKey(Dataset.WriteOffs, identity.key)
  if (existingKey) {
    return ok(Dataset.WriteOffs, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'inventory_write_off',
      entityId: existingKey.entityId,
      missingFields: [],
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.WriteOffs, rowNumber, row, 'created', { sourceKey: identity.key, missingFields: [] })
  }
  try {
    const created = await ctx.store.createImportedWriteOff({ writeOffDate, reason, notes, lines })
    await persistKey(ctx, {
      dataset: Dataset.WriteOffs,
      sourceKey: identity.key,
      entityType: 'inventory_write_off',
      entityId: created.writeOffId,
      payloadHash: hash,
    })
    return ok(Dataset.WriteOffs, rowNumber, row, 'created', {
      sourceKey: identity.key,
      entityType: 'inventory_write_off',
      entityId: created.writeOffId,
      missingFields: [],
    })
  } catch (error) {
    return fail(Dataset.WriteOffs, rowNumber, row, error instanceof Error ? error.message : 'Ошибка списания.', {
      sourceKey: identity.key,
    })
  }
}

export async function handleSales(ctx: HandlerContext, row: CsvRow, rowNumber: number): Promise<RowOutcome> {
  const sourceId = pick(row, 'source_id')
  const number = pick(row, 'number')
  const identity = resolveIdentity(Dataset.Sales, sourceId, [{ label: 'number', value: number }])
  if ('error' in identity) {
    return fail(Dataset.Sales, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  if (!number) {
    return fail(Dataset.Sales, rowNumber, row, 'Укажите номер продажи.', { sourceKey: identity.key })
  }
  const saleDate = parseDate(pick(row, 'sale_date'))
  if (!saleDate) {
    return fail(Dataset.Sales, rowNumber, row, 'Укажите дату продажи.', { sourceKey: identity.key })
  }

  let customerId = await resolveMapped(ctx.store, Dataset.Customers, pick(row, 'customer_source_id'))
  if (!customerId) {
    const retail = await ctx.store.findCustomerByEmail('roapp-retail@import.local')
    if (retail) {
      customerId = retail.id
    } else if (!ctx.dryRun) {
      const created = await ctx.store.upsertCustomer({
        name: 'Розничный покупатель (RO App)',
        kind: 'individual',
        inn: '',
        kpp: '',
        ogrn: '',
        phone: '',
        email: 'roapp-retail@import.local',
        city: '',
        contactName: '',
        notes: 'Служебный клиент для продаж RO App без контрагента.',
      })
      customerId = created.record.id
    } else {
      customerId = 'dry-run-retail'
    }
  }

  const lineRows = linesForParent(ctx, Dataset.SaleLines, 'sale_source_id', sourceId)
  if (lineRows.length === 0) {
    return fail(Dataset.Sales, rowNumber, row, 'Нет строк продажи.', { sourceKey: identity.key })
  }

  const merged = new Map<string, { itemId: string; quantity: number; unitPrice: number; unitCost: number }>()
  for (const [index, line] of lineRows.entries()) {
    const quantity = parseNumber(pick(line, 'quantity'))
    const unitPrice = parseNumber(pick(line, 'unit_price'))
    if (quantity === null || quantity <= 0) {
      return fail(Dataset.Sales, rowNumber, row, `Строка ${index + 1}: количество должно быть больше нуля.`, {
        sourceKey: identity.key,
      })
    }
    if (unitPrice === null || unitPrice < 0) {
      return fail(Dataset.Sales, rowNumber, row, `Строка ${index + 1}: укажите цену.`, { sourceKey: identity.key })
    }
    const item = await resolveItem(ctx.store, line)
    if (!item) {
      return fail(
        Dataset.Sales,
        rowNumber,
        row,
        `Строка ${index + 1}: номенклатура не найдена (${pick(line, 'item_source_id') || pick(line, 'item_code') || '—'}).`,
        { sourceKey: identity.key },
      )
    }
    const unitCost = parseNumber(pick(line, 'cost')) ?? item.purchasePrice
    const current = merged.get(item.id)
    if (current) {
      const totalQty = current.quantity + quantity
      current.unitPrice = (current.unitPrice * current.quantity + unitPrice * quantity) / totalQty
      current.unitCost = (current.unitCost * current.quantity + unitCost * quantity) / totalQty
      current.quantity = totalQty
    } else {
      merged.set(item.id, { itemId: item.id, quantity, unitPrice, unitCost })
    }
  }

  const lines = [...merged.values()]
  const invoiceNumber = number.startsWith('RO-') ? number : `RO-${number}`
  const hash = payloadHash({ invoiceNumber, customerId, saleDate, lines })
  const existingKey = await ctx.store.getSourceKey(Dataset.Sales, identity.key)
  if (existingKey) {
    return ok(Dataset.Sales, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'sale',
      entityId: existingKey.entityId,
      missingFields: [],
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.Sales, rowNumber, row, 'created', { sourceKey: identity.key, missingFields: [] })
  }
  try {
    const created = await ctx.store.createImportedSale({
      invoiceNumber,
      customerId,
      saleDate,
      lines,
    })
    await persistKey(ctx, {
      dataset: Dataset.Sales,
      sourceKey: identity.key,
      entityType: 'sale',
      entityId: created.saleId,
      payloadHash: hash,
    })
    return ok(Dataset.Sales, rowNumber, row, 'created', {
      sourceKey: identity.key,
      entityType: 'sale',
      entityId: created.saleId,
      missingFields: [],
    })
  } catch (error) {
    return fail(Dataset.Sales, rowNumber, row, error instanceof Error ? error.message : 'Ошибка продажи.', {
      sourceKey: identity.key,
    })
  }
}

async function handleSatelliteStub(
  dataset: DatasetId,
  _ctx: HandlerContext,
  row: CsvRow,
  rowNumber: number,
): Promise<RowOutcome> {
  return ok(dataset, rowNumber, row, 'skipped', {
    sourceKey: pick(row, 'source_id') || null,
    missingFields: [],
    errorMessage: 'Строки обрабатываются вместе с документом.',
  })
}

async function resolveOrderId(store: ImportStore, row: CsvRow): Promise<string | null> {
  const mapped = await resolveMapped(store, Dataset.Orders, pick(row, 'order_source_id'))
  if (mapped) {
    return mapped
  }
  const number = pick(row, 'order_number')
  if (!number) {
    return null
  }
  return (await store.findOrderByNumber(number))?.id ?? null
}

export async function handleOrderServiceLines(
  ctx: HandlerContext,
  row: CsvRow,
  rowNumber: number,
): Promise<RowOutcome> {
  const identity = resolveIdentity(Dataset.OrderServiceLines, pick(row, 'source_id'), [
    { label: 'order_source_id|order_number', value: pick(row, 'order_source_id') || pick(row, 'order_number') },
    { label: 'name', value: pick(row, 'name') },
    { label: 'quantity', value: pick(row, 'quantity') },
    { label: 'unit_price', value: pick(row, 'unit_price') },
  ])
  if ('error' in identity) {
    return fail(Dataset.OrderServiceLines, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  const name = pick(row, 'name')
  if (!name) {
    return fail(Dataset.OrderServiceLines, rowNumber, row, 'Укажите наименование услуги.', {
      sourceKey: identity.key,
    })
  }
  const quantity = parseNumber(pick(row, 'quantity'))
  const unitPrice = parseNumber(pick(row, 'unit_price')) ?? 0
  if (quantity === null || quantity <= 0) {
    return fail(Dataset.OrderServiceLines, rowNumber, row, 'Количество должно быть больше нуля.', {
      sourceKey: identity.key,
    })
  }
  const orderId = await resolveOrderId(ctx.store, row)
  if (!orderId) {
    return fail(Dataset.OrderServiceLines, rowNumber, row, 'Заказ для услуги не найден.', {
      sourceKey: identity.key,
    })
  }
  const description = pick(row, 'description')
  const hash = payloadHash({ orderId, name, description, quantity, unitPrice })
  const existingKey = await ctx.store.getSourceKey(Dataset.OrderServiceLines, identity.key)
  if (existingKey) {
    return ok(Dataset.OrderServiceLines, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'order_service_line',
      entityId: existingKey.entityId,
      missingFields: [],
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.OrderServiceLines, rowNumber, row, 'created', { sourceKey: identity.key, missingFields: [] })
  }
  try {
    const created = await ctx.store.addImportedOrderServiceLine({
      orderId,
      name,
      description,
      quantity,
      unitPrice,
    })
    await persistKey(ctx, {
      dataset: Dataset.OrderServiceLines,
      sourceKey: identity.key,
      entityType: 'order_service_line',
      entityId: created.lineId,
      payloadHash: hash,
    })
    return ok(Dataset.OrderServiceLines, rowNumber, row, 'created', {
      sourceKey: identity.key,
      entityType: 'order_service_line',
      entityId: created.lineId,
      missingFields: [],
    })
  } catch (error) {
    return fail(
      Dataset.OrderServiceLines,
      rowNumber,
      row,
      error instanceof Error ? error.message : 'Ошибка услуги заказа.',
      { sourceKey: identity.key },
    )
  }
}

export async function handleOrderPartLines(
  ctx: HandlerContext,
  row: CsvRow,
  rowNumber: number,
): Promise<RowOutcome> {
  const identity = resolveIdentity(Dataset.OrderPartLines, pick(row, 'source_id'), [
    { label: 'order_source_id|order_number', value: pick(row, 'order_source_id') || pick(row, 'order_number') },
    { label: 'item_source_id|item_code|name', value: pick(row, 'item_source_id') || pick(row, 'item_code') || pick(row, 'name') },
    { label: 'quantity', value: pick(row, 'quantity') },
  ])
  if ('error' in identity) {
    return fail(Dataset.OrderPartLines, rowNumber, row, identity.error, { errorCode: 'no_identity' })
  }
  const quantity = parseNumber(pick(row, 'quantity'))
  const unitPrice = parseNumber(pick(row, 'unit_price')) ?? 0
  if (quantity === null || quantity <= 0) {
    return fail(Dataset.OrderPartLines, rowNumber, row, 'Количество должно быть больше нуля.', {
      sourceKey: identity.key,
    })
  }
  const orderId = await resolveOrderId(ctx.store, row)
  if (!orderId) {
    return fail(Dataset.OrderPartLines, rowNumber, row, 'Заказ для запчасти не найден.', {
      sourceKey: identity.key,
    })
  }
  const item = await resolveItem(ctx.store, row)
  const name = pick(row, 'name') || item?.name || ''
  if (!item && !name) {
    return fail(Dataset.OrderPartLines, rowNumber, row, 'Укажите запчасть или наименование.', {
      sourceKey: identity.key,
    })
  }
  const consumeStock = parseBoolean(pick(row, 'consume_stock')) === true
  const hash = payloadHash({
    orderId,
    itemId: item?.id ?? null,
    name,
    quantity,
    unitPrice,
    consumeStock,
  })
  const existingKey = await ctx.store.getSourceKey(Dataset.OrderPartLines, identity.key)
  if (existingKey) {
    return ok(Dataset.OrderPartLines, rowNumber, row, 'skipped', {
      sourceKey: identity.key,
      entityType: 'order_part_line',
      entityId: existingKey.entityId,
      missingFields: [],
    })
  }
  if (ctx.dryRun) {
    return ok(Dataset.OrderPartLines, rowNumber, row, 'created', { sourceKey: identity.key, missingFields: [] })
  }
  try {
    const created = await ctx.store.addImportedOrderPartLine({
      orderId,
      itemId: item?.id ?? null,
      name,
      quantity,
      unitPrice,
      consumeStock: Boolean(consumeStock && item),
    })
    await persistKey(ctx, {
      dataset: Dataset.OrderPartLines,
      sourceKey: identity.key,
      entityType: 'order_part_line',
      entityId: created.lineId,
      payloadHash: hash,
    })
    return ok(Dataset.OrderPartLines, rowNumber, row, 'created', {
      sourceKey: identity.key,
      entityType: 'order_part_line',
      entityId: created.lineId,
      missingFields: [],
    })
  } catch (error) {
    return fail(
      Dataset.OrderPartLines,
      rowNumber,
      row,
      error instanceof Error ? error.message : 'Ошибка запчасти заказа.',
      { sourceKey: identity.key },
    )
  }
}

export const handlers: Record<
  DatasetId,
  (ctx: HandlerContext, row: CsvRow, rowNumber: number) => Promise<RowOutcome>
> = {
  employees: handleEmployees,
  customers: handleCustomers,
  device_models: handleDeviceModels,
  warehouse_items: handleWarehouseItems,
  barcodes: handleBarcodes,
  prices: handlePrices,
  warehouse_stock: handleWarehouseStock,
  receipts: handleReceipts,
  receipt_lines: (ctx, row, rowNumber) => handleSatelliteStub(Dataset.ReceiptLines, ctx, row, rowNumber),
  write_offs: handleWriteOffs,
  write_off_lines: (ctx, row, rowNumber) => handleSatelliteStub(Dataset.WriteOffLines, ctx, row, rowNumber),
  sales: handleSales,
  sale_lines: (ctx, row, rowNumber) => handleSatelliteStub(Dataset.SaleLines, ctx, row, rowNumber),
  orders: handleOrders,
  order_service_lines: handleOrderServiceLines,
  order_part_lines: handleOrderPartLines,
  order_consumption: handleOrderConsumption,
}
