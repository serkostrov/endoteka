/**
 * Разовая выгрузка RO App → CSV для `npm run import`.
 *
 *   ROAPP_API_KEY=... npm run import:roapp -- --out import/data/roapp
 *
 * Не коммитьте API-ключ. После миграции перевыпустите ключ в RO App.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const BASE = 'https://api.roapp.io/v2'
const PAGE_DELAY_MS = 350

type RoStatus = { id: number; name: string; color?: string; group?: { type: number; name: string } }
type RoPhone = string | { phone?: string | null; title?: string | null }

type RoClient = {
  id: number
  is_organization?: boolean
  name?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: RoPhone[]
  phones?: RoPhone[]
  address?: string
  notes?: string
  tax_identification_number?: string
  custom_fields?: Record<string, string>
}

type RoPerson = RoClient & {
  first_name?: string
  last_name?: string
}

type RoOrganization = RoClient & {
  name?: string
  business_registration_number?: string
}
type RoAsset = {
  id: number
  uid?: string
  title?: string
  group?: string
  brand?: string
  model?: string
  modification?: string
}
type RoOrder = {
  id: number
  number: string
  status?: { id: number; name: string }
  created_at?: string
  due_date?: string | null
  malfunction?: string
  manager_notes?: string
  engineer_notes?: string
  client?: RoClient | null
  asset?: RoAsset | null
  custom_fields?: Record<string, string>
}
type RoProduct = {
  id: number
  category_id?: number
  title?: string
  description?: string
  code?: string
  sku?: string
  cost?: string
  barcodes?: Array<string | { code?: string; barcode?: string }>
  prices?: Array<{ id: number; price: string }>
}

type RoProductCategory = {
  id: number
  title?: string
  name?: string
  parent_id?: number | null
}

type RoSaleListItem = {
  id: number
  number?: string
  branch_id?: number
  created_at?: string
  client?: RoClient | null
  comment?: string
  total?: string
}

type RoSaleDetail = RoSaleListItem & {
  items?: Array<{
    id?: number
    quantity?: string | number
    price?: string | number
    cost?: string | number
    entity?: {
      id?: number
      type?: string
      code?: string
      sku?: string
      title?: string
    }
  }>
}

type RoIncomeLine = {
  id?: number
  quantity?: string | number
  cost?: string | number
  price?: string | number
  code?: string
  sku?: string
  title?: string
  entity?: {
    id?: number
    code?: string
    sku?: string
    title?: string
  }
  product?: {
    id?: number
    code?: string
    sku?: string
    title?: string
  }
}

type RoIncomeTransaction = {
  id?: number
  number?: string | number
  created_at?: string
  comment?: string
  notes?: string
  supplier?: RoClient | null
  client?: RoClient | null
  products?: RoIncomeLine[]
  items?: RoIncomeLine[]
}

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function toCsv(headers: string[], rows: Record<string, string>[]) {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? '')).join(','))
  }
  return `${lines.join('\n')}\n`
}

function slugCode(value: string) {
  const translit: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  }
  const lower = value.trim().toLocaleLowerCase('ru')
  let out = ''
  for (const char of lower) {
    if (translit[char] != null) {
      out += translit[char]
    } else if (/[a-z0-9]/.test(char)) {
      out += char
    } else if (/[\s_\-./\\]+/.test(char)) {
      out += '_'
    }
  }
  out = out.replace(/_+/g, '_').replace(/^_|_$/g, '')
  return out || 'item'
}

function pickCustom(fields: Record<string, string> | undefined, ...keys: string[]) {
  if (!fields) {
    return ''
  }
  for (const key of keys) {
    const value = String(fields[key] ?? '').trim()
    if (value) {
      return value
    }
  }
  return ''
}

function cityFromAddress(address: string) {
  const text = address.trim()
  if (!text) {
    return ''
  }
  const match = text.match(/(?:г\.|город)\s*([^,]+)/i) ?? text.match(/,\s*([^,]+)$/)
  return (match?.[1] ?? '').trim()
}

function firstPhone(value: RoPhone[] | undefined): string {
  if (!value?.length) {
    return ''
  }
  for (const item of value) {
    if (typeof item === 'string') {
      const phone = item.trim()
      if (phone) {
        return phone
      }
      continue
    }
    const phone = String(item?.phone ?? '').trim()
    if (phone) {
      return phone
    }
  }
  return ''
}

function customerName(client: RoClient, fallbackId: number): string {
  return (
    String(client.name || '').trim() ||
    [client.first_name, client.last_name].filter(Boolean).join(' ').trim() ||
    `Клиент RO ${fallbackId}`
  )
}

function buildCustomerRow(client: RoClient, kind: 'individual' | 'organization'): Record<string, string> {
  const fields = client.custom_fields ?? {}
  const inn =
    String(client.tax_identification_number ?? '').trim() ||
    pickCustom(fields, 'f561248', 'inn', 'ИНН')
  const kpp = pickCustom(fields, 'f6526597', 'kpp', 'КПП')
  const ogrn = pickCustom(fields, 'f6526598', 'ogrn', 'ОГРН')
  const contact = pickCustom(fields, 'f561255', 'f6526599', 'contact')
  const phone = firstPhone(client.phones) || firstPhone(client.phone)
  const address = String(client.address ?? '').trim()
  const notesParts = [
    String(client.notes ?? '').trim(),
    address ? `Адрес RO App: ${address}` : '',
  ].filter(Boolean)
  return {
    source_id: `ro-cus-${client.id}`,
    name: customerName(client, client.id),
    kind,
    inn,
    kpp,
    ogrn,
    phone,
    email: String(client.email ?? '').trim(),
    city: cityFromAddress(address),
    contact_name: contact,
    notes: notesParts.join('\n'),
  }
}

/** Enrich existing row with non-empty fields from a secondary source (orders payload). */
function mergeCustomerRow(
  primary: Record<string, string>,
  secondary: Record<string, string>,
): Record<string, string> {
  const next = { ...primary }
  for (const key of Object.keys(secondary)) {
    if (key === 'source_id' || key === 'kind') {
      continue
    }
    if (!String(next[key] ?? '').trim() && String(secondary[key] ?? '').trim()) {
      next[key] = String(secondary[key] ?? '')
    }
  }
  return next
}

/** RO App status name → Endoteka order_statuses.code */
function mapStatus(name: string): string {
  const n = name.trim().toLocaleLowerCase('ru')
  if (!n) {
    return 'received'
  }
  if (n === 'новый') {
    return 'received'
  }
  if (n.includes('диагност')) {
    return 'diagnostics'
  }
  if (n.includes('запчаст')) {
    return 'waiting_parts'
  }
  if (n.includes('согласован') || n.includes('требует согласован') || n.includes('списание')) {
    return 'waiting_approval'
  }
  if (n.includes('отказ') || n.includes('без ремонта')) {
    return 'cancelled'
  }
  if (
    n.includes('отдан') ||
    n.includes('доставк') ||
    n.includes('подмен') ||
    n.includes('на время')
  ) {
    return 'issued'
  }
  if (n.includes('готов') || n.includes('исправн') || n.includes('ожидает отправ')) {
    return 'ready'
  }
  if (
    n.includes('ремонт') ||
    n.includes('работе') ||
    n.includes('гарант') ||
    n === 'донор' ||
    n === 'то'
  ) {
    return 'repair'
  }
  return 'repair'
}

async function apiGet<T>(apiKey: string, pathName: string): Promise<T> {
  const response = await fetch(`${BASE}${pathName}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`RO App ${pathName}: HTTP ${response.status} ${body.slice(0, 200)}`)
  }
  return (await response.json()) as T
}

async function fetchAllPages<T>(
  apiKey: string,
  pathName: string,
  label: string,
): Promise<T[]> {
  const first = await apiGet<{ paging?: { total_pages?: number; count?: number }; data?: T[] }>(
    apiKey,
    `${pathName}${pathName.includes('?') ? '&' : '?'}page=1`,
  )
  const totalPages = Math.max(1, first.paging?.total_pages ?? 1)
  const rows = [...(first.data ?? [])]
  process.stdout.write(`${label}: страница 1/${totalPages} (всего ${first.paging?.count ?? rows.length})\n`)
  for (let page = 2; page <= totalPages; page += 1) {
    await sleep(PAGE_DELAY_MS)
    const next = await apiGet<{ data?: T[] }>(
      apiKey,
      `${pathName}${pathName.includes('?') ? '&' : '?'}page=${page}`,
    )
    rows.push(...(next.data ?? []))
    process.stdout.write(`${label}: страница ${page}/${totalPages}\n`)
  }
  return rows
}

async function tryFetchIncomeTransactions(
  apiKey: string,
  branchId: number,
): Promise<{ ok: true; rows: RoIncomeTransaction[] } | { ok: false; status: number; message: string }> {
  const pathName = `/warehouse/income-transactions/?branch_id=${branchId}`
  try {
    const rows = await fetchAllPages<RoIncomeTransaction>(apiKey, pathName, 'Оприходования')
    return { ok: true, rows }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const statusMatch = message.match(/\b(\d{3})\b/)
    return { ok: false, status: Number(statusMatch?.[1] ?? 0), message }
  }
}

async function fetchProductCategories(apiKey: string): Promise<RoProductCategory[]> {
  const pathName = '/catalog/products/categories'
  try {
    const paged = await fetchAllPages<RoProductCategory>(apiKey, pathName, 'Категории товаров')
    if (paged.length > 0) {
      return paged
    }
  } catch {
    // некоторые аккаунты отдают плоский массив без paging
  }
  const raw = await apiGet<RoProductCategory[] | { data?: RoProductCategory[] }>(apiKey, pathName)
  const rows = Array.isArray(raw) ? raw : (raw.data ?? [])
  process.stdout.write(`Категории товаров: ${rows.length}\n`)
  return rows
}

async function main() {
  const apiKey = process.env.ROAPP_API_KEY?.trim() || arg('--api-key').trim()
  const outDir = path.resolve(arg('--out', 'import/data/roapp'))
  if (!apiKey) {
    throw new Error('Укажите ROAPP_API_KEY или --api-key.')
  }

  await mkdir(outDir, { recursive: true })

  const people = await fetchAllPages<RoPerson>(apiKey, '/contacts/people', 'Люди')
  await sleep(PAGE_DELAY_MS)
  const organizations = await fetchAllPages<RoOrganization>(
    apiKey,
    '/contacts/organizations',
    'Организации',
  )
  await sleep(PAGE_DELAY_MS)
  const statuses = await apiGet<RoStatus[]>(apiKey, '/orders/statuses')
  await sleep(PAGE_DELAY_MS)
  const orders = await fetchAllPages<RoOrder>(apiKey, '/orders', 'Заказы')
  await sleep(PAGE_DELAY_MS)
  const productCategories = await fetchProductCategories(apiKey)
  await sleep(PAGE_DELAY_MS)
  const products = await fetchAllPages<RoProduct>(apiKey, '/catalog/products', 'Номенклатура')
  await sleep(PAGE_DELAY_MS)
  const saleSummaries = await fetchAllPages<RoSaleListItem>(apiKey, '/sales', 'Продажи')
  const saleDetails: RoSaleDetail[] = []
  for (const [index, summary] of saleSummaries.entries()) {
    await sleep(PAGE_DELAY_MS)
    const detail = await apiGet<RoSaleDetail>(apiKey, `/sales/${summary.id}`)
    saleDetails.push(detail)
    if ((index + 1) % 10 === 0 || index + 1 === saleSummaries.length) {
      process.stdout.write(`Продажи (детали): ${index + 1}/${saleSummaries.length}\n`)
    }
  }

  const branchIds = [
    ...new Set(
      saleSummaries
        .map((row) => row.branch_id)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    ),
  ]
  let incomeTransactions: RoIncomeTransaction[] = []
  let incomeApiNote =
    'Оприходования: Public API /warehouse/income-transactions на аккаунте недоступен — используйте Excel → import:roapp-receipts-convert.'
  if (branchIds.length > 0) {
    await sleep(PAGE_DELAY_MS)
    const incomeResult = await tryFetchIncomeTransactions(apiKey, branchIds[0]!)
    if (incomeResult.ok) {
      incomeTransactions = incomeResult.rows
      incomeApiNote = `Оприходования: /warehouse/income-transactions/?branch_id=${branchIds[0]} → receipts.csv + receipt-lines.csv.`
    } else {
      incomeApiNote = `Оприходования API HTTP ${incomeResult.status || '—'} — Excel → npm run import:roapp-receipts-convert.`
      process.stdout.write(`Оприходования API недоступны: ${incomeResult.message.slice(0, 160)}\n`)
    }
  }

  const categoryById = new Map<number, { code: string; name: string }>()
  for (const category of productCategories) {
    if (!category?.id) {
      continue
    }
    const name = String(category.title || category.name || '').trim() || `Категория ${category.id}`
    categoryById.set(category.id, {
      code: slugCode(name) || `cat_${category.id}`,
      name,
    })
  }

  const customers = new Map<string, Record<string, string>>()
  const models = new Map<string, Record<string, string>>()
  const orderRows: Record<string, string>[] = []
  const statusReport: Record<string, string> = {}

  for (const person of people) {
    if (!person?.id) {
      continue
    }
    customers.set(`ro-cus-${person.id}`, buildCustomerRow(person, 'individual'))
  }
  for (const org of organizations) {
    if (!org?.id) {
      continue
    }
    customers.set(`ro-cus-${org.id}`, buildCustomerRow(org, 'organization'))
  }

  for (const status of statuses) {
    statusReport[status.name] = mapStatus(status.name)
  }

  for (const order of orders) {
    const client = order.client
    if (client?.id) {
      const sourceId = `ro-cus-${client.id}`
      const fromOrder = buildCustomerRow(
        client,
        client.is_organization === false ? 'individual' : 'organization',
      )
      const existing = customers.get(sourceId)
      if (existing) {
        // Contacts API is source of truth for kind; orders only fill empty fields.
        customers.set(sourceId, mergeCustomerRow(existing, fromOrder))
      } else {
        customers.set(sourceId, fromOrder)
      }
    }

    const asset = order.asset
    let modelSourceId = ''
    if (asset) {
      const groupName = String(asset.group || '').trim() || 'Без типа'
      const brandName = String(asset.brand || '').trim() || 'Без бренда'
      const modelName = String(asset.model || '').trim() || String(asset.title || '').trim() || 'Без модели'
      const modificationName = String(asset.modification || '').trim()
      const groupCode = slugCode(groupName)
      const brandCode = slugCode(brandName)
      const modelCode = slugCode(modelName)
      const modificationCode = modificationName ? slugCode(modificationName) : ''
      modelSourceId = modificationCode
        ? `ro-mod-${groupCode}-${brandCode}-${modelCode}-${modificationCode}`
        : `ro-mod-${groupCode}-${brandCode}-${modelCode}`
      if (!models.has(modelSourceId)) {
        models.set(modelSourceId, {
          source_id: modelSourceId,
          group_code: groupCode,
          group_name: groupName,
          brand_code: brandCode,
          brand_name: brandName,
          model_code: modelCode,
          model_name: modelName,
          modification_code: modificationCode,
          modification_name: modificationName,
        })
      }
    }

    const serial =
      String(asset?.uid || '').trim() ||
      (asset?.id ? `RO-ASSET-${asset.id}` : '') ||
      `RO-ORDER-${order.id}`
    const statusName = String(order.status?.name || '').trim()
    const statusCode = mapStatus(statusName)
    const completeness = pickCustom(order.custom_fields, 'f1548545')
    const notes = [order.manager_notes, order.engineer_notes].map((v) => String(v || '').trim()).filter(Boolean)
    const malfunction = String(order.malfunction || '').trim() || notes.join(' · ')

    if (!client?.id) {
      process.stdout.write(`Пропуск заказа ${order.number}: нет клиента\n`)
      continue
    }

    orderRows.push({
      source_id: `ro-ord-${order.id}`,
      number: String(order.number || `RO-${order.id}`),
      customer_source_id: `ro-cus-${client.id}`,
      customer_inn: customers.get(`ro-cus-${client.id}`)?.inn ?? '',
      serial_number: serial,
      model_source_id: modelSourceId,
      claimed_malfunction: malfunction,
      completeness,
      external_condition: '',
      deadline: order.due_date ? String(order.due_date).slice(0, 10) : '',
      status_code: statusCode,
      employee_source_id: '',
      employee_email: '',
      created_at: order.created_at ? String(order.created_at) : '',
    })
  }

  const warehouseItems: Record<string, string>[] = []
  const barcodes: Record<string, string>[] = []
  const prices: Record<string, string>[] = []
  const saleRows: Record<string, string>[] = []
  const saleLineRows: Record<string, string>[] = []

  for (const product of products) {
    const sourceId = `ro-item-${product.id}`
    const code =
      String(product.code || '').trim() ||
      String(product.sku || '').trim() ||
      `RO-${product.id}`
    const name = String(product.title || '').trim() || `Позиция RO ${product.id}`
    const purchase = String(product.cost || '0').replace(',', '.')
    const retail = String(product.prices?.[0]?.price || '0').replace(',', '.')
    const repair = String(product.prices?.[1]?.price || product.prices?.[0]?.price || '0').replace(',', '.')
    const category =
      product.category_id != null ? categoryById.get(product.category_id) : undefined
    warehouseItems.push({
      source_id: sourceId,
      code,
      name,
      article: String(product.sku || '').trim(),
      barcode: '',
      category_code: category?.code || 'spare_parts',
      category_name: category?.name || 'Запчасти',
      unit_code: 'pcs',
      purchase_price: purchase,
      repair_price: repair,
      retail_price: retail,
    })
    prices.push({
      source_id: `ro-price-${product.id}`,
      item_source_id: sourceId,
      item_code: code,
      purchase_price: purchase,
      repair_price: repair,
      retail_price: retail,
    })
    const productBarcodes = product.barcodes ?? []
    productBarcodes.forEach((entry, index) => {
      const barcode =
        typeof entry === 'string'
          ? entry.trim()
          : String(entry.code || entry.barcode || '').trim()
      if (!barcode) {
        return
      }
      barcodes.push({
        source_id: `ro-bc-${product.id}-${index + 1}`,
        item_source_id: sourceId,
        item_code: code,
        barcode,
      })
    })
  }

  for (const sale of saleDetails) {
    if (!sale?.id) {
      continue
    }
    const saleSourceId = `ro-sale-${sale.id}`
    const clientId = sale.client?.id
    if (clientId) {
      const sourceId = `ro-cus-${clientId}`
      if (!customers.has(sourceId)) {
        customers.set(
          sourceId,
          buildCustomerRow(
            sale.client!,
            sale.client?.is_organization === false ? 'individual' : 'organization',
          ),
        )
      }
    }
    const saleDate = sale.created_at ? String(sale.created_at).slice(0, 10) : ''
    saleRows.push({
      source_id: saleSourceId,
      number: String(sale.number || `S${sale.id}`),
      customer_source_id: clientId ? `ro-cus-${clientId}` : '',
      sale_date: saleDate,
      notes: String(sale.comment || '').trim(),
    })

    const items = sale.items ?? []
    items.forEach((item, index) => {
      const entity = item.entity
      if (!entity?.id || entity.type === 'service') {
        return
      }
      const itemSourceId = `ro-item-${entity.id}`
      const itemCode =
        String(entity.code || '').trim() ||
        String(entity.sku || '').trim() ||
        `RO-${entity.id}`
      // Ensure product exists in warehouse CSV if sale references a catalog id not in list page.
      if (!warehouseItems.some((row) => row.source_id === itemSourceId)) {
        const cost = String(item.cost || '0').replace(',', '.')
        const price = String(item.price || '0').replace(',', '.')
        warehouseItems.push({
          source_id: itemSourceId,
          code: itemCode,
          name: String(entity.title || '').trim() || `Позиция RO ${entity.id}`,
          article: String(entity.sku || '').trim(),
          barcode: '',
          category_code: 'spare_parts',
          category_name: 'Запчасти',
          unit_code: 'pcs',
          purchase_price: cost,
          repair_price: price,
          retail_price: price,
        })
      }
      saleLineRows.push({
        source_id: `ro-sale-line-${item.id ?? `${sale.id}-${index + 1}`}`,
        sale_source_id: saleSourceId,
        item_source_id: itemSourceId,
        item_code: itemCode,
        quantity: String(item.quantity ?? '0').replace(',', '.'),
        unit_price: String(item.price ?? '0').replace(',', '.'),
        cost: String(item.cost ?? '0').replace(',', '.'),
        sort_order: String(index),
      })
    })
  }

  const receiptRows: Record<string, string>[] = []
  const receiptLineRows: Record<string, string>[] = []
  for (const income of incomeTransactions) {
    if (!income?.id) {
      continue
    }
    const receiptSourceId = `ro-rcp-${income.id}`
    const supplier = income.supplier ?? income.client ?? null
    const supplierId = supplier?.id
    if (supplierId) {
      const sourceId = `ro-cus-${supplierId}`
      if (!customers.has(sourceId)) {
        customers.set(
          sourceId,
          buildCustomerRow(
            supplier!,
            supplier?.is_organization === false ? 'individual' : 'organization',
          ),
        )
      }
    }
    const supplierName =
      String(supplier?.name || `${supplier?.first_name || ''} ${supplier?.last_name || ''}`.trim()).trim() ||
      'Поставщик RO App'
    receiptRows.push({
      source_id: receiptSourceId,
      receipt_date: income.created_at ? String(income.created_at).slice(0, 10) : '',
      supplier: supplierName,
      supplier_source_id: supplierId ? `ro-cus-${supplierId}` : '',
      notes: String(income.comment || income.notes || '').trim(),
    })

    const lines = income.products ?? income.items ?? []
    lines.forEach((line, index) => {
      const product = line.product ?? line.entity
      const productId = product?.id ?? line.id
      if (!productId) {
        return
      }
      const itemSourceId = `ro-item-${productId}`
      const itemCode =
        String(product?.code || line.code || '').trim() ||
        String(product?.sku || line.sku || '').trim() ||
        `RO-${productId}`
      if (!warehouseItems.some((row) => row.source_id === itemSourceId)) {
        const cost = String(line.cost || line.price || '0').replace(',', '.')
        warehouseItems.push({
          source_id: itemSourceId,
          code: itemCode,
          name: String(product?.title || line.title || '').trim() || `Позиция RO ${productId}`,
          article: String(product?.sku || line.sku || '').trim(),
          barcode: '',
          category_code: 'spare_parts',
          category_name: 'Запчасти',
          unit_code: 'pcs',
          purchase_price: cost,
          repair_price: cost,
          retail_price: cost,
        })
      }
      receiptLineRows.push({
        source_id: `ro-rcp-line-${income.id}-${line.id ?? index + 1}`,
        receipt_source_id: receiptSourceId,
        item_source_id: itemSourceId,
        item_code: itemCode,
        quantity: String(line.quantity ?? '0').replace(',', '.'),
        purchase_price: String(line.cost ?? line.price ?? '0').replace(',', '.'),
      })
    })
  }

  const files: Array<[string, string[], Record<string, string>[]]> = [
    [
      'customers.csv',
      [
        'source_id',
        'name',
        'kind',
        'inn',
        'kpp',
        'ogrn',
        'phone',
        'email',
        'city',
        'contact_name',
        'notes',
      ],
      [...customers.values()],
    ],
    [
      'device-models.csv',
      [
        'source_id',
        'group_code',
        'group_name',
        'brand_code',
        'brand_name',
        'model_code',
        'model_name',
        'modification_code',
        'modification_name',
      ],
      [...models.values()],
    ],
    [
      'warehouse-items.csv',
      [
        'source_id',
        'code',
        'name',
        'article',
        'barcode',
        'category_code',
        'category_name',
        'unit_code',
        'purchase_price',
        'repair_price',
        'retail_price',
      ],
      warehouseItems,
    ],
    [
      'barcodes.csv',
      ['source_id', 'item_source_id', 'item_code', 'barcode'],
      barcodes,
    ],
    [
      'prices.csv',
      [
        'source_id',
        'item_source_id',
        'item_code',
        'purchase_price',
        'repair_price',
        'retail_price',
      ],
      prices,
    ],
    [
      'orders.csv',
      [
        'source_id',
        'number',
        'customer_source_id',
        'customer_inn',
        'serial_number',
        'model_source_id',
        'claimed_malfunction',
        'completeness',
        'external_condition',
        'deadline',
        'status_code',
        'employee_source_id',
        'employee_email',
        'created_at',
      ],
      orderRows,
    ],
    [
      'sales.csv',
      ['source_id', 'number', 'customer_source_id', 'sale_date', 'notes'],
      saleRows,
    ],
    [
      'sale-lines.csv',
      [
        'source_id',
        'sale_source_id',
        'item_source_id',
        'item_code',
        'quantity',
        'unit_price',
        'cost',
        'sort_order',
      ],
      saleLineRows,
    ],
    [
      'receipts.csv',
      ['source_id', 'receipt_date', 'supplier', 'supplier_source_id', 'notes'],
      receiptRows,
    ],
    [
      'receipt-lines.csv',
      [
        'source_id',
        'receipt_source_id',
        'item_source_id',
        'item_code',
        'quantity',
        'purchase_price',
      ],
      receiptLineRows,
    ],
  ]

  for (const [fileName, headers, rows] of files) {
    await writeFile(path.join(outDir, fileName), toCsv(headers, rows), 'utf8')
  }

  const summary = {
    exportedAt: new Date().toISOString(),
    counts: {
      customers: customers.size,
      deviceModels: models.size,
      warehouseItems: warehouseItems.length,
      barcodes: barcodes.length,
      prices: prices.length,
      orders: orderRows.length,
      sales: saleRows.length,
      saleLines: saleLineRows.length,
      receipts: receiptRows.length,
      receiptLines: receiptLineRows.length,
      statusesMapped: Object.keys(statusReport).length,
    },
    statusMapping: statusReport,
    notes: [
      incomeApiNote,
      'Текущий остаток без истории документов: Excel → warehouse-stock.csv.',
      'Списания (outcome-transactions) в этом аккаунте API не отдаёт (404) — при наличии Excel используйте write-offs.csv + write-off-lines.csv.',
      'Продажи: /sales + /sales/{id} со строками → sales.csv + sale-lines.csv.',
      'Услуги (catalog/services) в импорт номенклатуры не включены — в Endoteka это отдельный модуль шаблонов работ.',
      'Клиенты: полный список из /contacts/people и /contacts/organizations; заказы только дополняют пустые поля.',
      'Приборы (модели) собраны из asset заказов.',
      `Категории номенклатуры: ${categoryById.size} из /catalog/products/categories; позиции без category_id → «Запчасти».`,
      'После миграции перевыпустите API-ключ RO App.',
    ],
    contactCounts: {
      people: people.length,
      organizations: organizations.length,
      customersTotal: customers.size,
    },
  }
  await writeFile(path.join(outDir, 'export-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  const readme = `# Выгрузка RO App → Endoteka

Сформировано: ${summary.exportedAt}

## Счётчики
- Клиенты: ${summary.counts.customers} (люди: ${summary.contactCounts.people}, организации: ${summary.contactCounts.organizations})
- Виды приборов: ${summary.counts.deviceModels}
- Номенклатура: ${summary.counts.warehouseItems}
- Штрихкоды: ${summary.counts.barcodes}
- Цены: ${summary.counts.prices}
- Заказы: ${summary.counts.orders}
- Продажи: ${summary.counts.sales} (строк: ${summary.counts.saleLines})
- Приходы: ${summary.counts.receipts} (строк: ${summary.counts.receiptLines})

## Импорт в Endoteka

\`\`\`bash
# preview (без записи)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\
  npm run import -- preview --dir ${path.relative(process.cwd(), outDir)} --phase full --store supabase --out import/reports/roapp-preview

# запись
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\
  npm run import -- import --dir ${path.relative(process.cwd(), outDir)} --phase full --store supabase --out import/reports/roapp-import
\`\`\`

## Маппинг статусов
${Object.entries(statusReport)
  .map(([from, to]) => `- ${from} → \`${to}\``)
  .join('\n')}

## Ограничения
${summary.notes.map((line) => `- ${line}`).join('\n')}
`
  await writeFile(path.join(outDir, 'README.md'), readme, 'utf8')

  process.stdout.write(`\nГотово: ${outDir}\n`)
  process.stdout.write(JSON.stringify(summary.counts, null, 2) + '\n')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
