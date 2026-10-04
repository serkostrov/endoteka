import { randomBytes } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
  RowOutcome,
  SourceKeyRecord,
  DatasetId,
} from './types.ts'

type AnyClient = SupabaseClient

export function createSupabaseStoreFromEnv(): ImportStore {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('Для импорта нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.')
  }
  return createSupabaseStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }))
}

export function createSupabaseStore(client: AnyClient): ImportStore {
  const setCache = new Map<string, string>()

  async function setId(code: string): Promise<string> {
    const cached = setCache.get(code)
    if (cached) {
      return cached
    }
    const { data, error } = await client.from('reference_sets').select('id').eq('code', code).maybeSingle()
    if (error || !data) {
      throw new Error(error?.message ?? `Справочник ${code} не найден.`)
    }
    setCache.set(code, data.id)
    return data.id
  }

  return {
    async startRun(input: { phase: ImportPhase; dryRun: boolean; sourceDir: string }) {
      const { data, error } = await client
        .from('import_runs')
        .insert({
          phase: input.phase,
          status: input.dryRun ? 'preview' : 'running',
          dry_run: input.dryRun,
          source_dir: input.sourceDir,
        })
        .select('id, phase, status, dry_run')
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Не удалось создать прогон импорта.')
      }
      return { id: data.id, phase: data.phase, status: data.status, dryRun: data.dry_run } as ImportRun
    },

    async finishRun(runId, status, totals, errorMessage) {
      const { error } = await client
        .from('import_runs')
        .update({
          status,
          totals,
          finished_at: new Date().toISOString(),
          error_message: errorMessage ?? null,
        })
        .eq('id', runId)
      if (error) {
        throw new Error(error.message)
      }
    },

    async getSourceKey(dataset, sourceKey) {
      const { data, error } = await client
        .from('import_source_keys')
        .select('dataset, source_key, entity_type, entity_id, payload_hash')
        .eq('dataset', dataset)
        .eq('source_key', sourceKey)
        .maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      if (!data) {
        return null
      }
      return {
        dataset: data.dataset,
        sourceKey: data.source_key,
        entityType: data.entity_type,
        entityId: data.entity_id,
        payloadHash: data.payload_hash,
      }
    },

    async putSourceKey(record: SourceKeyRecord, runId: string) {
      const { error } = await client.from('import_source_keys').upsert({
        dataset: record.dataset,
        source_key: record.sourceKey,
        entity_type: record.entityType,
        entity_id: record.entityId,
        payload_hash: record.payloadHash,
        last_run_id: runId,
      })
      if (error) {
        throw new Error(error.message)
      }
    },

    async recordRow(runId, outcome: RowOutcome) {
      const { error } = await client.from('import_row_results').insert({
        run_id: runId,
        dataset: outcome.dataset,
        row_number: outcome.rowNumber,
        source_key: outcome.sourceKey,
        status: outcome.status,
        missing_fields: outcome.missingFields,
        error_code: outcome.errorCode ?? null,
        error_message: outcome.errorMessage ?? null,
        payload: outcome.payload,
      })
      if (error) {
        throw new Error(error.message)
      }
    },

    async listFailedRows(runId) {
      const { data, error } = await client
        .from('import_row_results')
        .select('dataset, row_number, source_key, status, missing_fields, error_code, error_message, payload')
        .eq('run_id', runId)
        .eq('status', 'failed')
        .order('row_number')
      if (error) {
        throw new Error(error.message)
      }
      return (data ?? []).map((row) => ({
        dataset: row.dataset as DatasetId,
        rowNumber: row.row_number,
        sourceKey: row.source_key,
        status: 'failed' as const,
        missingFields: row.missing_fields ?? [],
        errorCode: row.error_code ?? undefined,
        errorMessage: row.error_message ?? undefined,
        payload: (row.payload ?? {}) as Record<string, string>,
      }))
    },

    async findRole(code) {
      const { data, error } = await client.from('roles').select('id, code').eq('code', code).maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      return data
    },

    async findStatus(code) {
      return this.findReference('order_statuses', code)
    },

    async findReferenceById(id) {
      const { data, error } = await client
        .from('reference_items')
        .select('id, code, name, parent_id, set_id, reference_sets(code)')
        .eq('id', id)
        .maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      if (!data) {
        return null
      }
      const sets = data.reference_sets as { code: string } | { code: string }[] | null
      const setCode = Array.isArray(sets) ? sets[0]?.code : sets?.code
      return {
        id: data.id,
        setCode: setCode ?? '',
        code: data.code,
        name: data.name,
        parentId: data.parent_id,
      }
    },

    async findReference(setCode, code) {
      const sid = await setId(setCode)
      const { data, error } = await client
        .from('reference_items')
        .select('id, code, name, parent_id')
        .eq('set_id', sid)
        .eq('code', code)
        .maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      if (!data) {
        return null
      }
      return { id: data.id, setCode, code: data.code, name: data.name, parentId: data.parent_id }
    },

    async upsertReference(input) {
      const sid = await setId(input.setCode)
      const mapRow = (row: { id: string; code: string; name: string; parent_id: string | null }) => ({
        id: row.id,
        setCode: input.setCode,
        code: row.code,
        name: row.name,
        parentId: row.parent_id,
      })

      // Codes/names are unique among siblings (same set + parent), case-insensitive for names.
      let siblingsQuery = client
        .from('reference_items')
        .select('id, code, name, parent_id')
        .eq('set_id', sid)
      siblingsQuery =
        input.parentId == null
          ? siblingsQuery.is('parent_id', null)
          : siblingsQuery.eq('parent_id', input.parentId)
      const { data: siblings, error: siblingsError } = await siblingsQuery
      if (siblingsError) {
        throw new Error(siblingsError.message)
      }
      const peers = siblings ?? []
      const nameKey = input.name.trim().toLocaleLowerCase('ru')
      const byName = peers.find((row) => row.name.trim().toLocaleLowerCase('ru') === nameKey)
      if (byName) {
        return { record: mapRow(byName), created: false }
      }
      const byCode = peers.find((row) => row.code === input.code)
      if (byCode) {
        const { error } = await client
          .from('reference_items')
          .update({ name: input.name.trim() })
          .eq('id', byCode.id)
        if (error) {
          throw new Error(error.message)
        }
        return { record: { ...mapRow(byCode), name: input.name.trim() }, created: false }
      }

      const base = input.code.replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'item'
      const safeBase = (/^[a-z]/.test(base) ? base : `item_${base}`).slice(0, 64)
      const taken = new Set(peers.map((row) => row.code))
      let code = safeBase
      for (let suffix = 2; taken.has(code); suffix += 1) {
        const tail = `_${suffix}`
        code = `${safeBase.slice(0, 64 - tail.length)}${tail}`
        if (suffix > 1000) {
          code = `item_${Date.now().toString(36)}`.slice(0, 64)
          break
        }
      }

      const { data, error } = await client
        .from('reference_items')
        .insert({
          set_id: sid,
          code,
          name: input.name.trim(),
          parent_id: input.parentId,
          is_system: false,
        })
        .select('id, code, name, parent_id')
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Не удалось создать запись справочника.')
      }
      return { record: mapRow(data), created: true }
    },

    async findEmployeeByEmail(email) {
      const { data, error } = await client
        .from('profiles')
        .select('id, email, full_name, is_active')
        .eq('email', email)
        .maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      if (!data) {
        return null
      }
      return mapEmployee(data, await roleCodeOf(client, data.id))
    },

    async findEmployeeById(id) {
      const { data, error } = await client
        .from('profiles')
        .select('id, email, full_name, is_active')
        .eq('id', id)
        .maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      if (!data) {
        return null
      }
      return mapEmployee(data, await roleCodeOf(client, data.id))
    },

    async upsertEmployee(input) {
      const existing = input.id ? await this.findEmployeeById(input.id) : await this.findEmployeeByEmail(input.email)
      if (existing) {
        const { error } = await client
          .from('profiles')
          .update({ full_name: input.fullName, email: input.email, is_active: input.isActive })
          .eq('id', existing.id)
        if (error) {
          throw new Error(error.message)
        }
        await assignRole(client, existing.id, input.roleCode)
        return { record: { ...existing, ...input, id: existing.id }, created: false }
      }

      const created = await client.auth.admin.createUser({
        email: input.email,
        password: randomBytes(24).toString('hex'),
        email_confirm: true,
        user_metadata: { full_name: input.fullName },
      })
      if (created.error || !created.data.user) {
        throw new Error(created.error?.message ?? 'Не удалось создать пользователя.')
      }
      const userId = created.data.user.id
      await client.from('profiles').update({ full_name: input.fullName, email: input.email, is_active: input.isActive }).eq('id', userId)
      await assignRole(client, userId, input.roleCode)
      return {
        record: {
          id: userId,
          email: input.email,
          fullName: input.fullName,
          roleCode: input.roleCode,
          isActive: input.isActive,
        },
        created: true,
      }
    },

    async findCustomerByInn(inn) {
      if (!inn) {
        return null
      }
      const { data, error } = await client.from('customers').select('*').eq('inn', inn).maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      return data ? mapCustomer(data) : null
    },

    async findCustomerByEmail(email) {
      if (!email) {
        return null
      }
      const { data, error } = await client.from('customers').select('*').eq('email', email).maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      return data ? mapCustomer(data) : null
    },

    async findCustomerById(id) {
      const { data, error } = await client.from('customers').select('*').eq('id', id).maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      return data ? mapCustomer(data) : null
    },

    async upsertCustomer(input) {
      const payload = {
        name: input.name,
        kind: input.kind,
        inn: input.inn,
        kpp: input.kpp,
        ogrn: input.ogrn,
        phone: input.phone,
        email: input.email,
        city: input.city,
        contact_name: input.contactName,
        notes: input.notes,
      }
      if (input.id) {
        const { data, error } = await client.from('customers').update(payload).eq('id', input.id).select('*').single()
        if (error || !data) {
          throw new Error(error?.message ?? 'Не удалось обновить клиента.')
        }
        return { record: mapCustomer(data), created: false }
      }
      const { data, error } = await client.from('customers').insert(payload).select('*').single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Не удалось создать клиента.')
      }
      return { record: mapCustomer(data), created: true }
    },

    async findItemByCode(code) {
      const { data, error } = await client.from('inventory_items').select('*').ilike('code', code).maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      return data ? mapItem(data) : null
    },

    async findItemById(id) {
      const { data, error } = await client.from('inventory_items').select('*').eq('id', id).maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      return data ? mapItem(data) : null
    },

    async upsertItem(input) {
      const payload = {
        code: input.code,
        name: input.name,
        article: input.article,
        barcode: input.barcode,
        category_id: input.categoryId,
        unit_id: input.unitId,
        purchase_price: input.purchasePrice,
        repair_price: input.repairPrice,
        retail_price: input.retailPrice,
      }
      if (input.id) {
        const { data, error } = await client.from('inventory_items').update(payload).eq('id', input.id).select('*').single()
        if (error || !data) {
          throw new Error(error?.message ?? 'Не удалось обновить номенклатуру.')
        }
        return { record: mapItem(data), created: false }
      }
      const { data, error } = await client.from('inventory_items').insert(payload).select('*').single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Не удалось создать номенклатуру.')
      }
      return { record: mapItem(data), created: true }
    },

    async findDeviceBySerial(serial) {
      const { data, error } = await client.from('devices').select('*').ilike('serial_number', serial).maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      return data ? mapDevice(data) : null
    },

    async upsertDevice(input) {
      const payload = {
        serial_number: input.serialNumber,
        customer_id: input.customerId,
        group_id: input.groupId,
        brand_id: input.brandId,
        model_id: input.modelId,
        modification_id: input.modificationId,
      }
      if (input.id) {
        const { data, error } = await client.from('devices').update(payload).eq('id', input.id).select('*').single()
        if (error || !data) {
          throw new Error(error?.message ?? 'Не удалось обновить прибор.')
        }
        return { record: mapDevice(data), created: false }
      }
      const existing = await this.findDeviceBySerial(input.serialNumber)
      if (existing) {
        return this.upsertDevice({ ...input, id: existing.id })
      }
      const { data, error } = await client.from('devices').insert(payload).select('*').single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Не удалось создать прибор.')
      }
      return { record: mapDevice(data), created: true }
    },

    async findOrderByNumber(number) {
      const { data, error } = await client.from('orders').select('*').eq('number', number).maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      return data ? mapOrder(data) : null
    },

    async upsertOrder(input) {
      const payload = {
        number: input.number,
        number_seq: input.numberSeq,
        customer_id: input.customerId,
        device_id: input.deviceId,
        serial_number: input.serialNumber,
        claimed_malfunction: input.claimedMalfunction,
        completeness: input.completeness,
        external_condition: input.externalCondition,
        deadline: input.deadline,
        responsible_id: input.responsibleId,
        status_id: input.statusId,
        created_at: input.createdAt,
      }
      if (input.id) {
        const { data, error } = await client.from('orders').update(payload).eq('id', input.id).select('*').single()
        if (error || !data) {
          throw new Error(error?.message ?? 'Не удалось обновить заказ.')
        }
        return { record: mapOrder(data), created: false }
      }
      const { data, error } = await client.from('orders').insert(payload).select('*').single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Не удалось создать заказ.')
      }
      return { record: mapOrder(data), created: true }
    },

    async bumpOrderSequence(seq) {
      const { data, error } = await client.from('order_number_sequence').select('last_value').eq('id', 1).maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      const current = Number(data?.last_value ?? 0)
      if (seq > current) {
        const update = await client.from('order_number_sequence').update({ last_value: seq }).eq('id', 1)
        if (update.error) {
          throw new Error(update.error.message)
        }
      }
    },

    async listBatches(itemId) {
      const { data, error } = await client
        .from('inventory_batches')
        .select('id, item_id, remaining_quantity, purchase_price, receipt_date')
        .eq('item_id', itemId)
        .gt('remaining_quantity', 0)
        .order('receipt_date')
      if (error) {
        throw new Error(error.message)
      }
      return (data ?? []).map(
        (row): BatchRecord => ({
          id: row.id,
          itemId: row.item_id,
          remainingQuantity: Number(row.remaining_quantity),
          purchasePrice: Number(row.purchase_price),
          receiptDate: row.receipt_date,
        }),
      )
    },

    async createStockReceipt(input) {
      const receipt = await client
        .from('inventory_receipts')
        .insert({
          supplier: input.supplier,
          receipt_date: input.receiptDate,
          notes: 'Импорт остатков',
        })
        .select('id')
        .single()
      if (receipt.error || !receipt.data) {
        throw new Error(receipt.error?.message ?? 'Не удалось создать приход.')
      }
      const batch = await client
        .from('inventory_batches')
        .insert({
          item_id: input.itemId,
          receipt_id: receipt.data.id,
          supplier: input.supplier,
          receipt_date: input.receiptDate,
          purchase_price: input.purchasePrice,
          quantity: input.quantity,
          remaining_quantity: 0,
        })
        .select('id')
        .single()
      if (batch.error || !batch.data) {
        throw new Error(batch.error?.message ?? 'Не удалось создать партию.')
      }
      const movement = await client.from('inventory_movements').insert({
        item_id: input.itemId,
        batch_id: batch.data.id,
        quantity: input.quantity,
        unit_price: input.purchasePrice,
        movement_type: 'receipt',
        reference_type: 'receipt',
        reference_id: receipt.data.id,
      })
      if (movement.error) {
        throw new Error(movement.error.message)
      }
      return { receiptId: receipt.data.id, batchId: batch.data.id }
    },

    async createImportedReceipt(input) {
      if (input.lines.length === 0) {
        throw new Error('Добавьте хотя бы одну позицию прихода.')
      }
      const receipt = await client
        .from('inventory_receipts')
        .insert({
          supplier: input.supplier,
          supplier_id: input.supplierId,
          receipt_date: input.receiptDate,
          notes: input.notes || 'Импорт прихода RO App',
        })
        .select('id')
        .single()
      if (receipt.error || !receipt.data) {
        throw new Error(receipt.error?.message ?? 'Не удалось создать приход.')
      }

      for (const line of input.lines) {
        const batch = await client
          .from('inventory_batches')
          .insert({
            item_id: line.itemId,
            receipt_id: receipt.data.id,
            supplier: input.supplier,
            receipt_date: input.receiptDate,
            purchase_price: line.purchasePrice,
            quantity: line.quantity,
            remaining_quantity: 0,
          })
          .select('id')
          .single()
        if (batch.error || !batch.data) {
          throw new Error(batch.error?.message ?? 'Не удалось создать партию прихода.')
        }
        const movement = await client.from('inventory_movements').insert({
          item_id: line.itemId,
          batch_id: batch.data.id,
          quantity: line.quantity,
          unit_price: line.purchasePrice,
          movement_type: 'receipt',
          reference_type: 'receipt',
          reference_id: receipt.data.id,
        })
        if (movement.error) {
          throw new Error(movement.error.message)
        }
      }

      return { receiptId: receipt.data.id }
    },

    async consumeForOrder(input) {
      const { data, error } = await client.rpc('consume_inventory_fifo', {
        target_item_id: input.itemId,
        consume_quantity: input.quantity,
        target_movement_type: 'repair_consumption',
        target_reference_type: 'order',
        target_reference_id: input.orderId,
      })
      if (error) {
        throw new Error(error.message)
      }
      const lines = (data as { lines?: Array<{ movement_id: string }> } | null)?.lines ?? []
      return { movementIds: lines.map((line) => line.movement_id) }
    },

    async createImportedWriteOff(input) {
      const writeOff = await client
        .from('inventory_write_offs')
        .insert({
          write_off_date: input.writeOffDate,
          reason: input.reason,
          notes: input.notes || 'Импорт RO App',
        })
        .select('id')
        .single()
      if (writeOff.error || !writeOff.data) {
        throw new Error(writeOff.error?.message ?? 'Не удалось создать списание.')
      }

      for (const line of input.lines) {
        await ensureStockForConsume(client, {
          itemId: line.itemId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          receiptDate: input.writeOffDate,
          supplier: `Импорт RO App / ${input.reason}`,
        })
        const { error } = await client.rpc('consume_inventory_fifo', {
          target_item_id: line.itemId,
          consume_quantity: line.quantity,
          target_movement_type: 'write_off',
          target_reference_type: 'inventory_write_off',
          target_reference_id: writeOff.data.id,
        })
        if (error) {
          throw new Error(error.message)
        }
      }
      return { writeOffId: writeOff.data.id }
    },

    async createImportedSale(input) {
      const sale = await client
        .from('sales')
        .insert({
          invoice_number: input.invoiceNumber,
          customer_id: input.customerId,
          sale_date: input.saleDate,
          status: 'draft',
          total: 0,
        })
        .select('id')
        .single()
      if (sale.error || !sale.data) {
        throw new Error(sale.error?.message ?? 'Не удалось создать продажу.')
      }

      let sortOrder = 0
      const lineIds: Array<{ id: string; itemId: string; quantity: number; unitCost: number }> = []
      for (const line of input.lines) {
        const inserted = await client
          .from('sale_lines')
          .insert({
            sale_id: sale.data.id,
            item_id: line.itemId,
            quantity: line.quantity,
            unit_price: line.unitPrice,
            sort_order: sortOrder,
          })
          .select('id')
          .single()
        if (inserted.error || !inserted.data) {
          throw new Error(inserted.error?.message ?? 'Не удалось добавить строку продажи.')
        }
        lineIds.push({
          id: inserted.data.id,
          itemId: line.itemId,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })
        sortOrder += 1
      }

      const total = input.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
      await client
        .from('sales')
        .update({ total: Math.round(total * 100) / 100 })
        .eq('id', sale.data.id)

      for (const line of lineIds) {
        await ensureStockForConsume(client, {
          itemId: line.itemId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          receiptDate: input.saleDate,
          supplier: `Импорт RO App / ${input.invoiceNumber}`,
        })
        const { data, error } = await client.rpc('consume_inventory_fifo', {
          target_item_id: line.itemId,
          consume_quantity: line.quantity,
          target_movement_type: 'sale',
          target_reference_type: 'sale',
          target_reference_id: sale.data.id,
        })
        if (error) {
          throw new Error(error.message)
        }
        const fifoLines =
          (data as { lines?: Array<{ batch_id: string; movement_id: string; quantity: number; unit_price: number }> } | null)
            ?.lines ?? []
        for (const alloc of fifoLines) {
          const allocation = await client.from('sale_allocations').insert({
            sale_id: sale.data.id,
            line_id: line.id,
            batch_id: alloc.batch_id,
            movement_id: alloc.movement_id,
            quantity: alloc.quantity,
            unit_cost: alloc.unit_price,
          })
          if (allocation.error) {
            throw new Error(allocation.error.message)
          }
        }
      }

      const confirmed = await client
        .from('sales')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', sale.data.id)
        .eq('status', 'draft')
      if (confirmed.error) {
        throw new Error(confirmed.error.message)
      }
      return { saleId: sale.data.id }
    },

    async addImportedOrderServiceLine(input) {
      const { data, error } = await client
        .from('order_service_lines')
        .insert({
          order_id: input.orderId,
          template_id: null,
          name: input.name,
          description: input.description,
          quantity: input.quantity,
          unit_price: input.unitPrice,
        })
        .select('id')
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Не удалось добавить услугу в заказ.')
      }
      return { lineId: data.id }
    },

    async addImportedOrderPartLine(input) {
      const { data, error } = await client
        .from('order_part_lines')
        .insert({
          order_id: input.orderId,
          item_id: input.itemId,
          name: input.itemId ? '' : input.name,
          quantity: input.quantity,
          unit_price: input.unitPrice,
        })
        .select('id')
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Не удалось добавить запчасть в заказ.')
      }
      if (input.consumeStock && input.itemId) {
        await ensureStockForConsume(client, {
          itemId: input.itemId,
          quantity: input.quantity,
          unitCost: input.unitPrice,
          receiptDate: new Date().toISOString().slice(0, 10),
          supplier: `Импорт RO App / заказ`,
        })
        const consumed = await client.rpc('consume_inventory_fifo', {
          target_item_id: input.itemId,
          consume_quantity: input.quantity,
          target_movement_type: 'repair_consumption',
          target_reference_type: 'order',
          target_reference_id: input.orderId,
        })
        if (consumed.error) {
          throw new Error(consumed.error.message)
        }
      }
      return { lineId: data.id }
    },
  }
}

async function ensureStockForConsume(
  client: AnyClient,
  input: {
    itemId: string
    quantity: number
    unitCost: number
    receiptDate: string
    supplier: string
  },
) {
  const { data: batches, error } = await client
    .from('inventory_batches')
    .select('remaining_quantity')
    .eq('item_id', input.itemId)
  if (error) {
    throw new Error(error.message)
  }
  const available = (batches ?? []).reduce((sum, row) => sum + Number(row.remaining_quantity), 0)
  const missing = input.quantity - available
  if (missing <= 0) {
    return
  }
  const receipt = await client
    .from('inventory_receipts')
    .insert({
      supplier: input.supplier,
      receipt_date: input.receiptDate,
      notes: 'Автоприход для импорта документа RO App',
    })
    .select('id')
    .single()
  if (receipt.error || !receipt.data) {
    throw new Error(receipt.error?.message ?? 'Не удалось создать автоприход.')
  }
  const batch = await client
    .from('inventory_batches')
    .insert({
      item_id: input.itemId,
      receipt_id: receipt.data.id,
      supplier: input.supplier,
      receipt_date: input.receiptDate,
      purchase_price: input.unitCost,
      quantity: missing,
      remaining_quantity: 0,
    })
    .select('id')
    .single()
  if (batch.error || !batch.data) {
    throw new Error(batch.error?.message ?? 'Не удалось создать партию автоприхода.')
  }
  const movement = await client.from('inventory_movements').insert({
    item_id: input.itemId,
    batch_id: batch.data.id,
    quantity: missing,
    unit_price: input.unitCost,
    movement_type: 'receipt',
    reference_type: 'receipt',
    reference_id: receipt.data.id,
  })
  if (movement.error) {
    throw new Error(movement.error.message)
  }
}

async function roleCodeOf(client: AnyClient, userId: string): Promise<string> {
  const { data } = await client
    .from('user_roles')
    .select('roles(code)')
    .eq('user_id', userId)
    .maybeSingle()
  const roles = data?.roles as { code: string } | { code: string }[] | null | undefined
  if (Array.isArray(roles)) {
    return roles[0]?.code ?? ''
  }
  return roles?.code ?? ''
}

async function assignRole(client: AnyClient, userId: string, roleCode: string) {
  const { data, error } = await client.from('roles').select('id').eq('code', roleCode).maybeSingle()
  if (error || !data) {
    throw new Error(error?.message ?? 'Роль не найдена.')
  }
  await client.from('user_roles').delete().eq('user_id', userId)
  const inserted = await client.from('user_roles').insert({ user_id: userId, role_id: data.id })
  if (inserted.error) {
    throw new Error(inserted.error.message)
  }
}

function mapEmployee(
  row: { id: string; email: string; full_name: string; is_active: boolean },
  roleCode: string,
): EmployeeRecord {
  return { id: row.id, email: row.email, fullName: row.full_name, isActive: row.is_active, roleCode }
}

function mapCustomer(row: Record<string, unknown>): CustomerRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    kind: String(row.kind ?? 'organization'),
    inn: String(row.inn ?? ''),
    kpp: String(row.kpp ?? ''),
    ogrn: String(row.ogrn ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    city: String(row.city ?? ''),
    contactName: String(row.contact_name ?? ''),
    notes: String(row.notes ?? ''),
  }
}

function mapItem(row: Record<string, unknown>): ItemRecord {
  return {
    id: String(row.id),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    article: String(row.article ?? ''),
    barcode: String(row.barcode ?? ''),
    categoryId: String(row.category_id ?? ''),
    unitId: String(row.unit_id ?? ''),
    purchasePrice: Number(row.purchase_price ?? 0),
    repairPrice: Number(row.repair_price ?? 0),
    retailPrice: Number(row.retail_price ?? 0),
  }
}

function mapDevice(row: Record<string, unknown>): DeviceRecord {
  return {
    id: String(row.id),
    serialNumber: String(row.serial_number ?? ''),
    customerId: row.customer_id ? String(row.customer_id) : null,
    groupId: row.group_id ? String(row.group_id) : null,
    brandId: row.brand_id ? String(row.brand_id) : null,
    modelId: row.model_id ? String(row.model_id) : null,
    modificationId: row.modification_id ? String(row.modification_id) : null,
  }
}

function mapOrder(row: Record<string, unknown>): OrderRecord {
  return {
    id: String(row.id),
    number: String(row.number ?? ''),
    customerId: String(row.customer_id ?? ''),
    deviceId: String(row.device_id ?? ''),
    serialNumber: String(row.serial_number ?? ''),
    claimedMalfunction: String(row.claimed_malfunction ?? ''),
    completeness: String(row.completeness ?? ''),
    externalCondition: String(row.external_condition ?? ''),
    deadline: row.deadline ? String(row.deadline) : null,
    responsibleId: row.responsible_id ? String(row.responsible_id) : null,
    statusId: String(row.status_id ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}
