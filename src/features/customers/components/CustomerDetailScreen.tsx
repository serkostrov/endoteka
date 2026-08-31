import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'

import { DataTable } from '@/components/shared/DataTable'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageTabs } from '@/components/shared/PageTabs'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { DynamicFieldRenderer, DynamicFieldValue, DynamicFieldsGrid, saveDynamicFieldValues } from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { useHasPermission } from '@/features/auth'
import { deviceSerialLine, deviceTitle } from '@/features/devices/classification'
import { ReceiveStockSheet } from '@/features/inventory/components/ReceiveStockSheet'
import { ReceiptDeleteControl } from '@/features/inventory/components/ReceiptDeleteControl'
import { useInventoryReceipt } from '@/features/inventory/hooks/use-inventory'
import { CustomerKind } from '@/lib/constants/customers'
import { FieldEntity, fieldLayoutWidthClass } from '@/lib/constants/fields'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { formatDate, formatDateTime } from '@/lib/utils/date'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { CustomerFields } from './CustomerFields'
import { customerKindLabel, customerFormSchema, nameLabel, type CustomerFormValues } from '../schemas'
import { useCustomerCard, useUpdateCustomer } from '../hooks/use-customers'
import type { Customer, CustomerDevice, CustomerHistoryEvent, CustomerOrder, CustomerReceipt } from '../services/customers-service'

type CustomerTab = 'card' | 'devices' | 'orders' | 'receipts' | 'history'

export function CustomerDetailScreen() {
  const { id } = useParams()
  const cardQuery = useCustomerCard(id)

  if (cardQuery.isLoading) {
    return <LoadingState label="Загрузка контакта" />
  }

  if (cardQuery.error) {
    return <ErrorState description={getErrorMessage(cardQuery.error)} />
  }

  const card = cardQuery.data
  if (!card) {
    return <ErrorState description="Контакт не найден." />
  }

  const { customer, devices, orders, receipts, history } = card

  return (
    <div className="space-y-4">
      <PageHeader
        title={customer.name}
        description={`${customerKindLabel(customer.kind)} · обновлён ${formatDateTime(customer.updatedAt)}`}
      />

      <CustomerCardTabs customer={customer} devices={devices} orders={orders} receipts={receipts} history={history} />
    </div>
  )
}

function CustomerCardTabs({
  customer,
  devices,
  orders,
  receipts,
  history,
}: {
  customer: Customer
  devices: CustomerDevice[]
  orders: CustomerOrder[]
  receipts: CustomerReceipt[]
  history: CustomerHistoryEvent[]
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<CustomerTab>('card')
  const showReceipts = receipts.length > 0
  const tabItems = [
    { id: 'card' as const, label: 'Карточка' },
    { id: 'devices' as const, label: 'Приборы', count: devices.length },
    { id: 'orders' as const, label: 'Заказы', count: orders.length },
    ...(showReceipts ? [{ id: 'receipts' as const, label: 'Поставки', count: receipts.length }] : []),
    { id: 'history' as const, label: 'История', count: history.length },
  ]

  return (
    <div className="space-y-4">
      <PageTabs
        aria-label="Разделы карточки контакта"
        value={tab}
        onChange={setTab}
        items={tabItems}
      />

      {tab === 'card' ? (
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <CustomerDataSection customer={customer} />
          <CustomerFieldsSection customerId={customer.id} />
        </div>
      ) : null}

      {tab === 'devices' ? (
        <SectionCard title="Приборы" description="Приборы из заказов этого клиента и текущей привязки.">
          <DataTable
            caption="Приборы клиента"
            data={devices}
            getRowId={(row) => row.id}
            emptyTitle="Приборов нет"
            emptyDescription="Появятся, когда клиент сдаст эндоскоп в ремонт."
            onRowClick={(row) => navigate(routes.device.replace(':id', row.id))}
            columns={[
              { id: 'device', header: 'Прибор', cell: (row) => deviceTitle(row) },
              { id: 'serial', header: 'Серийный номер', cell: (row) => row.serialNumber },
            ]}
          />
        </SectionCard>
      ) : null}

      {tab === 'orders' ? (
        <SectionCard title="Заказы" description="Обращения этой организации или физлица.">
          <DataTable
            caption="Заказы клиента"
            data={orders}
            getRowId={(row) => row.id}
            emptyTitle="Заказов нет"
            emptyDescription="Новые заказы появятся после приёмки."
            onRowClick={(row) => navigate(routes.order.replace(':id', row.id))}
            columns={[
              { id: 'number', header: 'Номер', cell: (row) => row.number },
              { id: 'device', header: 'Прибор', cell: (row) => (
                <span className="block">
                  <span className="block">{row.deviceLabel || '—'}</span>
                  {row.serialNumber ? (
                    <span className="block text-muted-foreground">{deviceSerialLine(row.serialNumber)}</span>
                  ) : null}
                </span>
              ) },
              { id: 'status', header: 'Статус', cell: (row) => row.statusName },
              { id: 'created', header: 'Принят', cell: (row) => formatDate(row.createdAt) },
            ]}
          />
        </SectionCard>
      ) : null}

      {tab === 'receipts' && showReceipts ? (
        <CustomerReceiptsSection customer={customer} receipts={receipts} />
      ) : null}

      {tab === 'history' ? (
        <SectionCard title="История" description="Создание и изменения карточки. Записи только для чтения.">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Записей пока нет.</p>
          ) : (
            <ol className="space-y-3">
              {history.map((event) => (
                <li key={event.id} className="border-b pb-3 last:border-b-0 last:pb-0">
                  <p className="text-sm font-medium">{event.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                    {event.actorName ? ` · ${event.actorName}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      ) : null}
    </div>
  )
}

function CustomerReceiptsSection({
  customer,
  receipts,
}: {
  customer: Customer
  receipts: CustomerReceipt[]
}) {
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const receiptQuery = useInventoryReceipt(selectedId)

  return (
    <>
      {selectedId && receiptQuery.data ? (
        <SectionCard
          title={`Приход · ${receiptQuery.data.supplier}`}
          description={`${formatDate(receiptQuery.data.receiptDate)}${receiptQuery.data.notes ? ` · ${receiptQuery.data.notes}` : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <ReceiptDeleteControl
                receipt={{ id: receiptQuery.data.id, supplier: receiptQuery.data.supplier }}
                variant="button"
                onDeleted={() => setSelectedId(undefined)}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(undefined)}>
                Скрыть
              </Button>
            </div>
          }
        >
          <DataTable
            caption="Строки прихода"
            data={receiptQuery.data.lines}
            getRowId={(row) => row.id}
            emptyTitle="Строк нет"
            columns={[
              { id: 'name', header: 'Позиция', cell: (row) => row.itemName },
              { id: 'code', header: 'Код', cell: (row) => row.itemCode },
              { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(row.quantity) },
              { id: 'price', header: 'Цена', cell: (row) => formatMoney(row.unitPrice) },
              { id: 'left', header: 'Остаток партии', cell: (row) => formatQuantity(row.remainingQuantity) },
            ]}
          />
        </SectionCard>
      ) : null}

      <SectionCard
        title="Поставки"
        description="Приходы от этой организации."
        actions={
          canReceive ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый приход
            </Button>
          ) : null
        }
      >
        <DataTable
          caption="Приходы поставщика"
          data={receipts}
          getRowId={(row) => row.id}
          emptyTitle="Поставок нет"
          emptyDescription="Оформите приход от этой организации."
          onRowClick={(row) => setSelectedId(row.id)}
          columns={[
            { id: 'date', header: 'Дата', cell: (row) => formatDate(row.receiptDate) },
            { id: 'lines', header: 'Строк', cell: (row) => String(row.lineCount) },
            { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(row.totalQuantity) },
            {
              id: 'actor',
              header: 'Кто',
              className: 'hidden md:table-cell',
              cell: (row) => row.actorName || '—',
            },
            {
              id: 'created',
              header: 'Создан',
              className: 'hidden lg:table-cell',
              cell: (row) => formatDateTime(row.createdAt),
            },
            ...(canReceive
              ? [
                  {
                    id: 'actions',
                    header: '',
                    className: 'w-[1%] whitespace-nowrap',
                    cell: (row: CustomerReceipt) => (
                      <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                        <ReceiptDeleteControl
                          receipt={{ id: row.id, supplier: row.supplier }}
                          onDeleted={() => {
                            if (selectedId === row.id) {
                              setSelectedId(undefined)
                            }
                          }}
                        />
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </SectionCard>

      <ReceiveStockSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        presetSupplier={{ id: customer.id, name: customer.name }}
      />
    </>
  )
}

function CustomerDataSection({ customer }: { customer: Customer }) {
  const canUpdate = useHasPermission(Permission.CustomersUpdate)
  const [editing, setEditing] = useState(false)

  return (
    <SectionCard
      title="Данные контакта"
      description={editing ? 'Изменения сохраняются отдельной кнопкой.' : undefined}
      className="h-full"
      actions={
        canUpdate && !editing ? (
          <IconActionButton label="Редактировать" onClick={() => setEditing(true)}>
            <Pencil />
          </IconActionButton>
        ) : null
      }
    >
      {editing ? (
        <CustomerEditForm customer={customer} onDone={() => setEditing(false)} />
      ) : (
        <CustomerView customer={customer} />
      )}
    </SectionCard>
  )
}

function CustomerView({ customer }: { customer: Customer }) {
  const isOrg = customer.kind === CustomerKind.Organization

  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <Info label="Тип" value={customerKindLabel(customer.kind)} />
      <Info label={nameLabel(customer.kind)} value={customer.name} />
      <Info label={isOrg ? 'Контактное лицо' : 'Доп. контакт'} value={customer.contactName} />
      <Info label="Город" value={customer.city} />
      <Info label="Телефон" value={customer.phone} />
      <Info label="Email" value={customer.email} />
      <Info label="ИНН" value={customer.inn} />
      {isOrg ? <Info label="КПП" value={customer.kpp} /> : null}
      <Info label={isOrg ? 'ОГРН' : 'ОГРНИП'} value={customer.ogrn} />
      <div className="sm:col-span-2">
        <Info label="Заметка" value={customer.notes} />
      </div>
    </dl>
  )
}

function CustomerEditForm({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const update = useUpdateCustomer(customer.id)
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: customerToForm(customer),
  })

  async function onSubmit(values: CustomerFormValues) {
    try {
      await update.mutateAsync(values)
      toast.success('Контакт сохранён')
      onDone()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CustomerFields form={form} excludeCustomerId={customer.id} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Отмена
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Form>
  )
}

function customerToForm(customer: Customer): CustomerFormValues {
  return {
    kind: customer.kind,
    name: customer.name,
    contactName: customer.contactName,
    phone: customer.phone,
    email: customer.email,
    city: customer.city,
    inn: customer.inn,
    kpp: customer.kpp,
    ogrn: customer.ogrn,
    notes: customer.notes,
  }
}

function CustomerFieldsSection({ customerId }: { customerId: string }) {
  const canUpdate = useHasPermission(Permission.CustomersUpdate)
  const fieldsQuery = useDynamicFields(FieldEntity.Customers)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Customers, customerId)
  const queryClient = useQueryClient()
  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const [editing, setEditing] = useState(false)
  const [extraDraft, setExtraDraft] = useState<Record<string, DynamicFieldValueData> | null>(null)
  const extraValues = extraDraft ?? valuesQuery.data ?? {}
  const [saving, setSaving] = useState(false)

  if (activeFields.length === 0) {
    return (
      <SectionCard
        title="Дополнительные поля"
        description="Настраиваются в справочнике полей карточек."
        className="h-full"
      >
        <p className="text-sm text-muted-foreground">Дополнительных полей пока нет.</p>
      </SectionCard>
    )
  }

  function cancelEdit() {
    setExtraDraft(null)
    setEditing(false)
  }

  async function saveExtra() {
    setSaving(true)
    try {
      await saveDynamicFieldValues(FieldEntity.Customers, customerId, extraValues)
      setExtraDraft(null)
      setEditing(false)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fields.values(FieldEntity.Customers, customerId),
      })
      toast.success('Поля клиента сохранены')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Дополнительные поля"
      description="Настраиваются в справочнике полей карточек."
      className="h-full"
      actions={
        canUpdate && !editing ? (
          <IconActionButton label="Редактировать" onClick={() => setEditing(true)}>
            <Pencil />
          </IconActionButton>
        ) : null
      }
    >
      {editing ? (
        <>
          <DynamicFieldsGrid>
            {activeFields.map((field) => (
              <DynamicFieldRenderer
                key={field.id}
                field={field}
                value={extraValues[field.code] ?? emptyFieldValue(field)}
                onChange={(value) =>
                  setExtraDraft((current) => ({ ...(current ?? valuesQuery.data ?? {}), [field.code]: value }))
                }
              />
            ))}
          </DynamicFieldsGrid>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
              Отмена
            </Button>
            <Button type="button" onClick={() => void saveExtra()} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </>
      ) : (
        <dl className="grid grid-cols-12 gap-3 text-sm">
          {activeFields.map((field) => (
            <div key={field.id} className={fieldLayoutWidthClass(field)}>
              <dt className="text-muted-foreground">{field.name}</dt>
              <dd className="mt-0.5 font-medium">
                <DynamicFieldValue field={field} value={extraValues[field.code] ?? emptyFieldValue(field)} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </SectionCard>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value || '—'}</dd>
    </div>
  )
}
