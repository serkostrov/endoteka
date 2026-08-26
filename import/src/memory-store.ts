import type { ImportStore } from './store.ts'
import type {
  BatchRecord,
  CustomerRecord,
  DeviceRecord,
  EmployeeRecord,
  ImportPhase,
  ImportRun,
  ItemRecord,
  OrderRecord,
  ReferenceItemRecord,
  RowOutcome,
  SourceKeyRecord,
} from './types.ts'

function id(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`
}

export type MemorySnapshot = {
  employees: EmployeeRecord[]
  customers: CustomerRecord[]
  items: ItemRecord[]
  devices: DeviceRecord[]
  orders: OrderRecord[]
  movements: Array<{ id: string; itemId: string; orderId: string | null; quantity: number }>
  sourceKeys: SourceKeyRecord[]
}

export function createMemoryStore(): ImportStore & { snapshot(): MemorySnapshot; runs: ImportRun[] } {
  let seq = 1
  const nextId = (prefix: string) => id(prefix, seq++)

  const roles = [
    { id: 'role-director', code: 'director' },
    { id: 'role-manager', code: 'manager' },
    { id: 'role-chief', code: 'chief_engineer' },
    { id: 'role-diag', code: 'diagnostic_engineer' },
    { id: 'role-store', code: 'storekeeper' },
  ]
  const references: ReferenceItemRecord[] = [
    { id: 'st-received', setCode: 'order_statuses', code: 'received', name: 'Принят', parentId: null },
    { id: 'st-repair', setCode: 'order_statuses', code: 'repair', name: 'В ремонте', parentId: null },
    { id: 'st-issued', setCode: 'order_statuses', code: 'issued', name: 'Выдан', parentId: null },
    { id: 'st-cancelled', setCode: 'order_statuses', code: 'cancelled', name: 'Отменён', parentId: null },
    { id: 'cat-parts', setCode: 'inventory_categories', code: 'spare_parts', name: 'Запчасти', parentId: null },
    { id: 'cat-cons', setCode: 'inventory_categories', code: 'consumables', name: 'Расходники', parentId: null },
    { id: 'unit-pcs', setCode: 'units_of_measure', code: 'pcs', name: 'шт', parentId: null },
    { id: 'unit-pack', setCode: 'units_of_measure', code: 'pack', name: 'упак', parentId: null },
    { id: 'grp-flex', setCode: 'device_groups', code: 'flexible_endoscope', name: 'Гибкий эндоскоп', parentId: null },
    { id: 'br-oly', setCode: 'device_brands', code: 'olympus', name: 'Olympus', parentId: null },
  ]
  const employees: EmployeeRecord[] = []
  const customers: CustomerRecord[] = []
  const items: ItemRecord[] = []
  const devices: DeviceRecord[] = []
  const orders: OrderRecord[] = []
  const batches: BatchRecord[] = []
  const movements: Array<{ id: string; itemId: string; batchId: string; orderId: string | null; quantity: number }> = []
  const sourceKeys = new Map<string, SourceKeyRecord>()
  const rowResults = new Map<string, RowOutcome[]>()
  const runs: ImportRun[] = []

  function keyOf(dataset: string, sourceKey: string) {
    return `${dataset}::${sourceKey}`
  }

  const store: ImportStore & { snapshot(): MemorySnapshot; runs: ImportRun[] } = {
    runs,
    snapshot() {
      return {
        employees: [...employees],
        customers: [...customers],
        items: [...items],
        devices: [...devices],
        orders: [...orders],
        movements: movements.map((row) => ({
          id: row.id,
          itemId: row.itemId,
          orderId: row.orderId,
          quantity: row.quantity,
        })),
        sourceKeys: [...sourceKeys.values()],
      }
    },

    async startRun(input: { phase: ImportPhase; dryRun: boolean; sourceDir: string }) {
      const run: ImportRun = {
        id: nextId('run'),
        phase: input.phase,
        status: input.dryRun ? 'preview' : 'running',
        dryRun: input.dryRun,
      }
      runs.push(run)
      rowResults.set(run.id, [])
      return run
    },

    async finishRun(runId, status) {
      const run = runs.find((row) => row.id === runId)
      if (run) {
        run.status = status
      }
    },

    async getSourceKey(dataset, sourceKey) {
      return sourceKeys.get(keyOf(dataset, sourceKey)) ?? null
    },

    async putSourceKey(record, _runId) {
      sourceKeys.set(keyOf(record.dataset, record.sourceKey), record)
    },

    async recordRow(runId, outcome) {
      const list = rowResults.get(runId) ?? []
      list.push(outcome)
      rowResults.set(runId, list)
    },

    async listFailedRows(runId) {
      return (rowResults.get(runId) ?? []).filter((row) => row.status === 'failed')
    },

    async findRole(code) {
      return roles.find((row) => row.code === code) ?? null
    },

    async findStatus(code) {
      return references.find((row) => row.setCode === 'order_statuses' && row.code === code) ?? null
    },

    async findReferenceById(idValue) {
      return references.find((row) => row.id === idValue) ?? null
    },

    async findReference(setCode, code) {
      return references.find((row) => row.setCode === setCode && row.code === code) ?? null
    },

    async upsertReference(input) {
      const existing = references.find((row) => row.setCode === input.setCode && row.code === input.code)
      if (existing) {
        existing.name = input.name
        existing.parentId = input.parentId
        return { record: existing, created: false }
      }
      const record: ReferenceItemRecord = {
        id: nextId('ref'),
        setCode: input.setCode,
        code: input.code,
        name: input.name,
        parentId: input.parentId,
      }
      references.push(record)
      return { record, created: true }
    },

    async findEmployeeByEmail(email) {
      return employees.find((row) => row.email === email) ?? null
    },

    async findEmployeeById(idValue) {
      return employees.find((row) => row.id === idValue) ?? null
    },

    async upsertEmployee(input) {
      const existing = input.id
        ? employees.find((row) => row.id === input.id)
        : employees.find((row) => row.email === input.email)
      if (existing) {
        existing.email = input.email
        existing.fullName = input.fullName
        existing.roleCode = input.roleCode
        existing.isActive = input.isActive
        return { record: existing, created: false }
      }
      const record: EmployeeRecord = {
        id: input.id ?? nextId('emp'),
        email: input.email,
        fullName: input.fullName,
        roleCode: input.roleCode,
        isActive: input.isActive,
      }
      employees.push(record)
      return { record, created: true }
    },

    async findCustomerByInn(inn) {
      if (!inn) {
        return null
      }
      return customers.find((row) => row.inn === inn) ?? null
    },

    async findCustomerByEmail(email) {
      if (!email) {
        return null
      }
      return customers.find((row) => row.email === email) ?? null
    },

    async findCustomerById(idValue) {
      return customers.find((row) => row.id === idValue) ?? null
    },

    async upsertCustomer(input) {
      const existing = input.id ? customers.find((row) => row.id === input.id) : undefined
      if (existing) {
        Object.assign(existing, { ...input, id: existing.id })
        return { record: existing, created: false }
      }
      const duplicateName = customers.find((row) => row.name.toLowerCase() === input.name.toLowerCase())
      if (duplicateName) {
        throw new Error('Клиент с таким названием уже есть.')
      }
      const record: CustomerRecord = { ...input, id: input.id ?? nextId('cus') }
      customers.push(record)
      return { record, created: true }
    },

    async findItemByCode(code) {
      return items.find((row) => row.code.toLowerCase() === code.toLowerCase()) ?? null
    },

    async findItemById(idValue) {
      return items.find((row) => row.id === idValue) ?? null
    },

    async upsertItem(input) {
      const existing = input.id ? items.find((row) => row.id === input.id) : undefined
      if (existing) {
        Object.assign(existing, { ...input, id: existing.id })
        return { record: existing, created: false }
      }
      const nameTaken = items.find((row) => row.name.toLowerCase() === input.name.toLowerCase())
      if (nameTaken) {
        throw new Error('Позиция с таким названием уже есть.')
      }
      const record: ItemRecord = { ...input, id: input.id ?? nextId('itm') }
      items.push(record)
      return { record, created: true }
    },

    async findDeviceBySerial(serial) {
      return devices.find((row) => row.serialNumber.toLowerCase() === serial.toLowerCase()) ?? null
    },

    async upsertDevice(input) {
      const existing = input.id
        ? devices.find((row) => row.id === input.id)
        : devices.find((row) => row.serialNumber.toLowerCase() === input.serialNumber.toLowerCase())
      if (existing) {
        Object.assign(existing, { ...input, id: existing.id })
        return { record: existing, created: false }
      }
      const record: DeviceRecord = { ...input, id: input.id ?? nextId('dev') }
      devices.push(record)
      return { record, created: true }
    },

    async findOrderByNumber(number) {
      return orders.find((row) => row.number === number) ?? null
    },

    async upsertOrder(input) {
      const existing = input.id ? orders.find((row) => row.id === input.id) : orders.find((row) => row.number === input.number)
      if (existing) {
        existing.customerId = input.customerId
        existing.deviceId = input.deviceId
        existing.serialNumber = input.serialNumber
        existing.claimedMalfunction = input.claimedMalfunction
        existing.completeness = input.completeness
        existing.externalCondition = input.externalCondition
        existing.deadline = input.deadline
        existing.responsibleId = input.responsibleId
        existing.statusId = input.statusId
        return { record: existing, created: false }
      }
      const record: OrderRecord = {
        id: input.id ?? nextId('ord'),
        number: input.number,
        customerId: input.customerId,
        deviceId: input.deviceId,
        serialNumber: input.serialNumber,
        claimedMalfunction: input.claimedMalfunction,
        completeness: input.completeness,
        externalCondition: input.externalCondition,
        deadline: input.deadline,
        responsibleId: input.responsibleId,
        statusId: input.statusId,
        createdAt: input.createdAt,
      }
      orders.push(record)
      return { record, created: true }
    },

    async bumpOrderSequence() {
      return
    },

    async listBatches(itemId) {
      return batches
        .filter((row) => row.itemId === itemId && row.remainingQuantity > 0)
        .sort((left, right) => left.receiptDate.localeCompare(right.receiptDate))
    },

    async createStockReceipt(input) {
      const receiptId = nextId('rcp')
      const batch: BatchRecord = {
        id: nextId('bat'),
        itemId: input.itemId,
        remainingQuantity: input.quantity,
        purchasePrice: input.purchasePrice,
        receiptDate: input.receiptDate,
      }
      batches.push(batch)
      movements.push({
        id: nextId('mov'),
        itemId: input.itemId,
        batchId: batch.id,
        orderId: null,
        quantity: input.quantity,
      })
      return { receiptId, batchId: batch.id }
    },

    async consumeForOrder(input) {
      let remaining = input.quantity
      const movementIds: string[] = []
      const available = batches
        .filter((row) => row.itemId === input.itemId && row.remainingQuantity > 0)
        .sort((left, right) => left.receiptDate.localeCompare(right.receiptDate))
      const stock = available.reduce((sum, row) => sum + row.remainingQuantity, 0)
      if (stock < remaining) {
        throw new Error(`Недостаточно остатка. Доступно: ${stock}, запрошено: ${remaining}.`)
      }
      for (const batch of available) {
        if (remaining <= 0) {
          break
        }
        const take = Math.min(batch.remainingQuantity, remaining)
        batch.remainingQuantity -= take
        const movementId = nextId('mov')
        movements.push({
          id: movementId,
          itemId: input.itemId,
          batchId: batch.id,
          orderId: input.orderId,
          quantity: -take,
        })
        movementIds.push(movementId)
        remaining -= take
      }
      return { movementIds }
    },
  }

  return store
}
