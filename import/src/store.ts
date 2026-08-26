import type {
  BatchRecord,
  CustomerRecord,
  DeviceRecord,
  EmployeeRecord,
  ImportPhase,
  ImportRun,
  ImportTotals,
  ItemRecord,
  OrderRecord,
  ReferenceItemRecord,
  RowOutcome,
  SourceKeyRecord,
} from './types.ts'

export type ImportStore = {
  findReferenceById(id: string): Promise<ReferenceItemRecord | null>
  startRun(input: { phase: ImportPhase; dryRun: boolean; sourceDir: string }): Promise<ImportRun>
  finishRun(
    runId: string,
    status: 'preview' | 'completed' | 'failed' | 'interrupted',
    totals: ImportTotals,
    errorMessage?: string,
  ): Promise<void>
  getSourceKey(dataset: string, sourceKey: string): Promise<SourceKeyRecord | null>
  putSourceKey(record: SourceKeyRecord, runId: string): Promise<void>
  recordRow(runId: string, outcome: RowOutcome): Promise<void>
  listFailedRows(runId: string): Promise<RowOutcome[]>

  findRole(code: string): Promise<{ id: string; code: string } | null>
  findStatus(code: string): Promise<ReferenceItemRecord | null>
  findReference(setCode: string, code: string): Promise<ReferenceItemRecord | null>
  upsertReference(input: {
    setCode: string
    code: string
    name: string
    parentId: string | null
  }): Promise<{ record: ReferenceItemRecord; created: boolean }>

  findEmployeeByEmail(email: string): Promise<EmployeeRecord | null>
  findEmployeeById(id: string): Promise<EmployeeRecord | null>
  upsertEmployee(input: {
    id?: string
    email: string
    fullName: string
    roleCode: string
    isActive: boolean
  }): Promise<{ record: EmployeeRecord; created: boolean }>

  findCustomerByInn(inn: string): Promise<CustomerRecord | null>
  findCustomerByEmail(email: string): Promise<CustomerRecord | null>
  findCustomerById(id: string): Promise<CustomerRecord | null>
  upsertCustomer(input: Omit<CustomerRecord, 'id'> & { id?: string }): Promise<{
    record: CustomerRecord
    created: boolean
  }>

  findItemByCode(code: string): Promise<ItemRecord | null>
  findItemById(id: string): Promise<ItemRecord | null>
  upsertItem(input: Omit<ItemRecord, 'id'> & { id?: string }): Promise<{ record: ItemRecord; created: boolean }>

  findDeviceBySerial(serial: string): Promise<DeviceRecord | null>
  upsertDevice(input: Omit<DeviceRecord, 'id'> & { id?: string }): Promise<{ record: DeviceRecord; created: boolean }>

  findOrderByNumber(number: string): Promise<OrderRecord | null>
  upsertOrder(input: Omit<OrderRecord, 'id'> & { id?: string; numberSeq: number }): Promise<{
    record: OrderRecord
    created: boolean
  }>
  bumpOrderSequence(seq: number): Promise<void>

  listBatches(itemId: string): Promise<BatchRecord[]>
  createStockReceipt(input: {
    itemId: string
    quantity: number
    purchasePrice: number
    supplier: string
    receiptDate: string
  }): Promise<{ receiptId: string; batchId: string }>
  consumeForOrder(input: {
    orderId: string
    itemId: string
    quantity: number
    unitPrice: number | null
  }): Promise<{ movementIds: string[] }>
}
