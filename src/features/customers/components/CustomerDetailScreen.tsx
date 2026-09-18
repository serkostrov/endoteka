import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useOpenEntitySheet } from '@/app/sheet-stack'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { ErrorState } from '@/components/shared/ErrorState'
import { InlineTextInput } from '@/components/shared/InlineTextInput'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageTabs } from '@/components/shared/PageTabs'
import { SectionCard } from '@/components/shared/SectionCard'
import { SheetEntityToolbar } from '@/components/shared/SheetEntityToolbar'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetDirty,
  runSheetFormSave,
  useSheetExitPresence,
} from '@/components/ui/sheet'
import { DynamicFieldRenderer, DynamicFieldValue, DynamicFieldsGrid, saveDynamicFieldValues } from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { useHasPermission } from '@/features/auth'
import { deviceSerialLine, deviceTitle } from '@/features/devices/classification'
import { ReceiveStockSheet } from '@/features/inventory/components/ReceiveStockSheet'
import { ReceiptDeleteControl } from '@/features/inventory/components/ReceiptDeleteControl'
import { CustomerKind } from '@/lib/constants/customers'
import { FieldEntity, fieldLayoutWidthClass } from '@/lib/constants/fields'
import { formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { formatDate, formatDateTime } from '@/lib/utils/date'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { CustomerFields } from './CustomerFields'
import { customerKindLabel, customerFormSchema, nameLabel, type CustomerFormValues } from '../schemas'
import { useCustomerCard, useDeleteCustomer, useUpdateCustomer } from '../hooks/use-customers'
import type { Customer, CustomerDevice, CustomerHistoryEvent, CustomerOrder, CustomerReceipt } from '../services/customers-service'

type CustomerTab = 'card' | 'devices' | 'orders' | 'receipts' | 'history'

export function CustomerDetailSheet({
  customerId,
  open,
  onOpenChange,
}: {
  customerId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Сохранено для совместимости: правка по клику, без режима редактирования. */
  initialEditing?: boolean
}) {
  const presence = useSheetExitPresence(open, customerId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? (
        <CustomerDetailSheetContent
          key={presence.id}
          customerId={presence.id}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Sheet>
  )
}

function CustomerDetailSheetContent({
  customerId,
  onClose,
}: {
  customerId: string
  onClose: () => void
}) {
  const cardQuery = useCustomerCard(customerId)
  const canUpdate = useHasPermission(Permission.CustomersUpdate)
  const canDelete = useHasPermission(Permission.CustomersDelete)
  const remove = useDeleteCustomer()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [tab, setTab] = useState<CustomerTab>('card')
  const customer = cardQuery.data?.customer

  async function handleDelete() {
    try {
      await remove.mutateAsync(customerId)
      toast.success('Контакт удалён')
      setDeleteOpen(false)
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(96vw,40rem)]"
      onOpenAutoFocus={(event) => event.preventDefault()}
      actions={
        customer ? (
          <SheetEntityToolbar onDelete={canDelete ? () => setDeleteOpen(true) : undefined} />
        ) : null
      }
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Карточка контакта</SheetTitle>
        <SheetDescription>Просмотр и редактирование контакта. Список остаётся на фоне.</SheetDescription>
      </SheetHeader>
      <div className="space-y-4 p-4 pr-14">
        {cardQuery.isLoading ? (
          <LoadingState label="Загрузка контакта" className="min-h-40" />
        ) : cardQuery.error ? (
          <ErrorState description={getErrorMessage(cardQuery.error)} />
        ) : !cardQuery.data ? (
          <ErrorState description="Контакт не найден." />
        ) : (
          <CustomerCardBody
            customer={cardQuery.data.customer}
            devices={cardQuery.data.devices}
            orders={cardQuery.data.orders}
            receipts={cardQuery.data.receipts}
            history={cardQuery.data.history}
            layout="sheet"
            canEdit={canUpdate}
            tab={tab}
            onTabChange={setTab}
          />
        )}
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title="Удалить контакт"
        description={
          customer
            ? `${customer.name} будет удалён. Если есть связанные заказы или приборы, удаление не пройдёт.`
            : ''
        }
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />
    </SheetContent>
  )
}

function CustomerCardBody({
  customer,
  devices,
  orders,
  receipts,
  history,
  layout,
  canEdit,
  tab: tabProp,
  onTabChange,
}: {
  customer: Customer
  devices: CustomerDevice[]
  orders: CustomerOrder[]
  receipts: CustomerReceipt[]
  history: CustomerHistoryEvent[]
  layout: 'page' | 'sheet'
  canEdit: boolean
  tab?: CustomerTab
  onTabChange?: (tab: CustomerTab) => void
}) {
  const [tabLocal, setTabLocal] = useState<CustomerTab>('card')
  const tab = tabProp ?? tabLocal
  const setTab = onTabChange ?? setTabLocal
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
      {canEdit ? (
        <CustomerEditableCard
          customer={customer}
          layout={layout}
          tab={tab}
          onTabChange={setTab}
          tabItems={tabItems}
        />
      ) : (
        <>
          {layout === 'page' ? (
            <PageHeader
              title={customer.name}
              description={`${customerKindLabel(customer.kind)} · обновлён ${formatDateTime(customer.updatedAt)}`}
            />
          ) : (
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{customer.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {customerKindLabel(customer.kind)} · обновлён {formatDateTime(customer.updatedAt)}
              </p>
            </div>
          )}

          <PageTabs aria-label="Разделы карточки контакта" value={tab} onChange={setTab} items={tabItems} />

          {tab === 'card' ? (
            <div className="grid items-stretch gap-4">
              <SectionCard title="Данные контакта" className="h-full">
                <CustomerView customer={customer} />
              </SectionCard>
              <CustomerFieldsSection customerId={customer.id} canEdit={false} />
            </div>
          ) : null}
        </>
      )}

      {tab === 'devices' ? <CustomerDevicesSection devices={devices} /> : null}
      {tab === 'orders' ? <CustomerOrdersSection orders={orders} /> : null}
      {tab === 'receipts' && showReceipts ? (
        <CustomerReceiptsSection customer={customer} receipts={receipts} />
      ) : null}
      {tab === 'history' ? <CustomerHistorySection history={history} /> : null}
    </div>
  )
}

function CustomerDevicesSection({ devices }: { devices: CustomerDevice[] }) {
  const openSheet = useOpenEntitySheet()

  return (
    <SectionCard title="Приборы" description="Приборы из заказов этого клиента и текущей привязки.">
      <DataTable
        caption="Приборы клиента"
        data={devices}
        getRowId={(row) => row.id}
        emptyTitle="Приборов нет"
        emptyDescription="Появятся, когда клиент сдаст эндоскоп в ремонт."
        onRowClick={(row) => openSheet('device', row.id)}
        columns={[
          { id: 'device', header: 'Прибор', cell: (row) => deviceTitle(row) },
          { id: 'serial', header: 'Серийный номер', cell: (row) => row.serialNumber },
        ]}
      />
    </SectionCard>
  )
}

function CustomerOrdersSection({ orders }: { orders: CustomerOrder[] }) {
  const openSheet = useOpenEntitySheet()

  return (
    <SectionCard title="Заказы" description="Обращения этой организации или физлица.">
      <DataTable
        caption="Заказы клиента"
        data={orders}
        getRowId={(row) => row.id}
        emptyTitle="Заказов нет"
        emptyDescription="Новые заказы появятся после приёмки."
        onRowClick={(row) => openSheet('order', row.id)}
        columns={[
          { id: 'number', header: 'Номер', cell: (row) => row.number },
          {
            id: 'device',
            header: 'Прибор',
            cell: (row) => (
              <span className="block">
                <span className="block">{row.deviceLabel || '—'}</span>
                {row.serialNumber ? (
                  <span className="block text-muted-foreground">{deviceSerialLine(row.serialNumber)}</span>
                ) : null}
              </span>
            ),
          },
          { id: 'status', header: 'Статус', cell: (row) => row.statusName },
          { id: 'created', header: 'Принят', cell: (row) => formatDate(row.createdAt) },
        ]}
      />
    </SectionCard>
  )
}

function CustomerHistorySection({ history }: { history: CustomerHistoryEvent[] }) {
  return (
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
  const openSheet = useOpenEntitySheet()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <>
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
          onRowClick={(row) => openSheet('receipt', row.id)}
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
                        <ReceiptDeleteControl receipt={{ id: row.id, supplier: row.supplier }} />
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

function CustomerEditableCard({
  customer,
  layout,
  tab,
  onTabChange,
  tabItems,
}: {
  customer: Customer
  layout: 'page' | 'sheet'
  tab: CustomerTab
  onTabChange: (tab: CustomerTab) => void
  tabItems: { id: CustomerTab; label: string; count?: number }[]
}) {
  const update = useUpdateCustomer(customer.id)
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: customerToForm(customer),
  })
  const kind = form.watch('kind')

  useSheetDirty(form.formState.isDirty, () =>
    runSheetFormSave(form.handleSubmit, async (values) => {
      await update.mutateAsync(values)
      form.reset(values)
      toast.success('Контакт сохранён')
    }),
  )

  async function onSubmit(values: CustomerFormValues) {
    try {
      await update.mutateAsync(values)
      form.reset(values)
      toast.success('Контакт сохранён')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const titleField = (
    <FormField
      control={form.control}
      name="name"
      render={({ field }) => (
        <FormItem className="min-w-0 gap-0.5">
          <FormControl>
            <InlineTextInput
              {...field}
              fit="fill"
              aria-label={nameLabel(kind)}
              placeholder={nameLabel(kind)}
              className="text-lg font-semibold tracking-tight text-foreground md:text-lg"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {layout === 'page' ? (
          <PageHeader
            title={titleField}
            description={`${customerKindLabel(kind)} · обновлён ${formatDateTime(customer.updatedAt)}`}
          />
        ) : (
          <div className="min-w-0 space-y-1">
            {titleField}
            <p className="text-sm text-muted-foreground">
              {customerKindLabel(kind)} · обновлён {formatDateTime(customer.updatedAt)}
            </p>
          </div>
        )}

        <PageTabs aria-label="Разделы карточки контакта" value={tab} onChange={onTabChange} items={tabItems} />

        {tab === 'card' ? (
          <div className="grid items-stretch gap-4">
            <SectionCard title="Данные контакта" className="h-full">
              <CustomerFields form={form} excludeCustomerId={customer.id} hideName layout="card" />
            </SectionCard>
            <CustomerFieldsSection customerId={customer.id} canEdit />
          </div>
        ) : null}
      </form>
    </Form>
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

function CustomerFieldsSection({
  customerId,
  canEdit,
}: {
  customerId: string
  canEdit: boolean
}) {
  const fieldsQuery = useDynamicFields(FieldEntity.Customers)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Customers, customerId)
  const queryClient = useQueryClient()
  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const [extraDraft, setExtraDraft] = useState<Record<string, DynamicFieldValueData> | null>(null)
  const extraValues = extraDraft ?? valuesQuery.data ?? {}

  useSheetDirty(canEdit && extraDraft !== null, extraDraft ? () => saveExtra() : undefined)

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

  async function saveExtra() {
    try {
      await saveDynamicFieldValues(FieldEntity.Customers, customerId, extraValues)
      setExtraDraft(null)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fields.values(FieldEntity.Customers, customerId),
      })
      toast.success('Поля клиента сохранены')
    } catch (error) {
      toast.error(getErrorMessage(error))
      throw error
    }
  }

  return (
    <SectionCard
      title="Дополнительные поля"
      description="Настраиваются в справочнике полей карточек."
      className="h-full"
    >
      {canEdit ? (
        <DynamicFieldsGrid className="gap-3">
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
