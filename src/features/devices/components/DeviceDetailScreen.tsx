import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'

import { useOpenEntitySheet } from '@/app/sheet-stack'
import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { InlineTextInput } from '@/components/shared/InlineTextInput'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageTabs } from '@/components/shared/PageTabs'
import { SectionCard } from '@/components/shared/SectionCard'
import { SheetEntityToolbar } from '@/components/shared/SheetEntityToolbar'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  runSheetFormSave,
  useSheetDirty,
  useSheetExitPresence,
} from '@/components/ui/sheet'
import { DynamicFieldRenderer, DynamicFieldValue, DynamicFieldsGrid, saveDynamicFieldValues } from '@/features/dynamic-fields'
import { emptyFieldValue, filledFieldValues } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { useHasPermission } from '@/features/auth'
import { FieldEntity, fieldLayoutWidthClass } from '@/lib/constants/fields'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { formatDate, formatDateTime } from '@/lib/utils/date'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { DeviceClassificationFields } from './DeviceClassificationFields'
import { WarrantyBadge } from './WarrantyBadge'
import { CLASSIFICATION_NONE, deviceSerialLine, deviceTitle, emptyToNull } from '../classification'
import { useDeleteDevice, useDeviceCard, useUpdateDevice } from '../hooks/use-devices'
import { editDeviceSchema, type EditDeviceFormValues } from '../schemas'
import {
  isDeviceDuplicateError,
  type DeviceCard,
  type DeviceLookup,
  type DeviceWarranty,
} from '../services/devices-service'

type DeviceTab = 'card' | 'orders' | 'history' | 'warranties'

export function DeviceDetailSheet({
  deviceId,
  open,
  onOpenChange,
}: {
  deviceId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Сохранено для совместимости: правка по клику, без режима редактирования. */
  initialEditing?: boolean
}) {
  const presence = useSheetExitPresence(open, deviceId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? (
        <DeviceDetailSheetContent key={presence.id} deviceId={presence.id} onClose={() => onOpenChange(false)} />
      ) : null}
    </Sheet>
  )
}

function DeviceDetailSheetContent({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const cardQuery = useDeviceCard(deviceId)
  const canDelete = useHasPermission(Permission.DevicesDelete)
  const remove = useDeleteDevice()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [tab, setTab] = useState<DeviceTab>('card')
  const device = cardQuery.data?.device

  async function handleDelete() {
    try {
      await remove.mutateAsync(deviceId)
      toast.success('Прибор удалён')
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
        device ? (
          <SheetEntityToolbar onDelete={canDelete ? () => setDeleteOpen(true) : undefined} />
        ) : null
      }
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Прибор</SheetTitle>
        <SheetDescription>Карточка прибора. Список остаётся на фоне.</SheetDescription>
      </SheetHeader>
      <div className="space-y-4 p-4 pr-14">
        {cardQuery.isLoading ? (
          <LoadingState label="Загрузка прибора" className="min-h-40" />
        ) : cardQuery.error ? (
          <ErrorState description={getErrorMessage(cardQuery.error)} />
        ) : !cardQuery.data ? (
          <ErrorState description="Прибор не найден." />
        ) : (
          <DeviceCardBody
            card={cardQuery.data}
            layout="sheet"
            tab={tab}
            onTabChange={setTab}
            hideChromeActions
            onDeleted={onClose}
          />
        )}
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title="Удалить прибор"
        description={
          device
            ? `${deviceTitle(device)}. ${deviceSerialLine(device.serialNumber)} будет удалён. Если по нему есть заказы, удаление не пройдёт.`
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

function DeviceCardBody({
  card,
  layout,
  onDeleted,
  tab: tabProp,
  onTabChange,
  hideChromeActions = false,
}: {
  card: DeviceCard
  layout: 'page' | 'sheet'
  onDeleted?: () => void
  tab?: DeviceTab
  onTabChange?: (tab: DeviceTab) => void
  hideChromeActions?: boolean
}) {
  const navigate = useNavigate()
  const openSheet = useOpenEntitySheet()
  const canUpdate = useHasPermission(Permission.DevicesUpdate)
  const canDelete = useHasPermission(Permission.DevicesDelete)
  const remove = useDeleteDevice()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [tabLocal, setTabLocal] = useState<DeviceTab>('card')
  const tab = tabProp ?? tabLocal
  const setTab = onTabChange ?? setTabLocal
  const device = card.device
  const orders = device.repairs
  const pastRepairs = orders.filter((item) => item.statusCode === 'issued' || item.statusCode === 'cancelled')

  async function handleDelete() {
    try {
      await remove.mutateAsync(device.id)
      toast.success('Прибор удалён')
      setDeleteOpen(false)
      if (onDeleted) {
        onDeleted()
      } else {
        navigate(routes.devices)
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const headerActions = hideChromeActions ? null : canDelete ? (
    <IconActionButton
      label="Удалить"
      className="text-destructive hover:text-destructive"
      onClick={() => setDeleteOpen(true)}
    >
      <Trash2 />
    </IconActionButton>
  ) : null

  const tabItems = [
    { id: 'card' as const, label: 'Карточка' },
    { id: 'orders' as const, label: 'Заказы', count: orders.length },
    { id: 'history' as const, label: 'История', count: pastRepairs.length },
    { id: 'warranties' as const, label: 'Гарантии', count: card.warranties.length },
  ]

  if (canUpdate && tab === 'card') {
    return (
      <div className="space-y-4">
        <DeviceCardEditor device={device} layout={layout} tabItems={tabItems} onTabChange={setTab} />
        {!hideChromeActions ? (
          <ConfirmDialog
            open={deleteOpen}
            title="Удалить прибор"
            description={`${deviceTitle(device)}. ${deviceSerialLine(device.serialNumber)} будет удалён. Если по нему есть заказы, удаление не пройдёт.`}
            confirmLabel="Удалить"
            isPending={remove.isPending}
            onOpenChange={setDeleteOpen}
            onConfirm={() => void handleDelete()}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {layout === 'page' ? (
        <PageHeader
          title={deviceTitle(device)}
          description={deviceSerialLine(device.serialNumber)}
          actions={headerActions ?? undefined}
        />
      ) : (
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{deviceTitle(device)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{deviceSerialLine(device.serialNumber)}</p>
        </div>
      )}

      <PageTabs
        aria-label="Разделы карточки прибора"
        value={tab}
        onChange={setTab}
        items={tabItems}
      />

      {tab === 'card' ? <DeviceCardView device={device} /> : null}

      {tab === 'orders' ? (
        <SectionCard title="Заказы" description="Все ремонты этого серийного номера, независимо от текущего клиента.">
          <DataTable
            caption="Заказы прибора"
            data={orders}
            getRowId={(row) => row.id}
            emptyTitle="Заказов нет"
            emptyDescription="По этому серийному номеру ещё не было ремонтов."
            onRowClick={(row) => openSheet('order', row.id)}
            columns={[
              { id: 'number', header: 'Номер', cell: (row) => row.number },
              { id: 'client', header: 'Клиент', cell: (row) => row.customerName },
              { id: 'status', header: 'Статус', cell: (row) => row.statusName },
              {
                id: 'malfunction',
                header: 'Неисправность',
                className: 'hidden md:table-cell',
                cell: (row) => row.claimedMalfunction || '—',
              },
              { id: 'created', header: 'Принят', cell: (row) => formatDate(row.createdAt) },
            ]}
          />
        </SectionCard>
      ) : null}

      {tab === 'history' ? (
        <SectionCard title="История ремонтов" description="Выданные и закрытые обращения. Клиент указан на момент заказа.">
          {pastRepairs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Закрытых ремонтов пока нет.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {pastRepairs.map((repair) => (
                <li key={repair.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-b-0">
                  <span>
                    <EntitySheetLink kind="order" id={repair.id} className="font-medium hover:underline">
                      {repair.number}
                    </EntitySheetLink>
                    <span className="text-muted-foreground"> · {repair.customerName}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {repair.statusName} · {formatDate(repair.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}

      {tab === 'warranties' ? <WarrantiesSection warranties={card.warranties} /> : null}

      {!hideChromeActions ? (
        <ConfirmDialog
          open={deleteOpen}
          title="Удалить прибор"
          description={`${deviceTitle(device)}. ${deviceSerialLine(device.serialNumber)} будет удалён. Если по нему есть заказы, удаление не пройдёт.`}
          confirmLabel="Удалить"
          isPending={remove.isPending}
          onOpenChange={setDeleteOpen}
          onConfirm={() => void handleDelete()}
        />
      ) : null}
    </div>
  )
}

function DeviceCardView({ device }: { device: DeviceLookup }) {
  const fieldsQuery = useDynamicFields(FieldEntity.Devices)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Devices, device.id)
  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const extraValues = valuesQuery.data ?? {}

  return (
    <SectionCard title="Карточка" className="gap-4 py-4">
      <dl className="grid grid-cols-12 gap-x-4 gap-y-3 text-sm">
        <div className="col-span-12 sm:col-span-6">
          <dt className="text-muted-foreground">Гарантия</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2">
            <WarrantyBadge warranty={device.warranty} />
            {device.warranty && (
              <span className="text-muted-foreground">
                {formatDate(device.warranty.startsOn)} — {formatDate(device.warranty.endsOn)}
                {device.warranty.orderNumber ? ` · ${device.warranty.orderNumber}` : ''}
              </span>
            )}
          </dd>
        </div>
        <div className="col-span-12 sm:col-span-6">
          <Info label="Тип прибора" value={device.groupName} />
        </div>
        <div className="col-span-12 sm:col-span-6">
          <Info label="Производитель" value={device.brandName} />
        </div>
        <div className="col-span-12 sm:col-span-6">
          <Info label="Модель" value={device.modelName} />
        </div>
        <div className="col-span-12 sm:col-span-6">
          <Info label="Модификация" value={device.modificationName} />
        </div>
        <div className="col-span-12 sm:col-span-6">
          <Info label="Создан" value={formatDateTime(device.createdAt)} />
        </div>
        <div className="col-span-12 sm:col-span-6">
          <Info label="Обновлён" value={formatDateTime(device.updatedAt)} />
        </div>
        {activeFields.map((field) => (
          <div key={field.id} className={fieldLayoutWidthClass(field)}>
            <dt className="text-muted-foreground">{field.name}</dt>
            <dd className="mt-0.5 font-medium">
              <DynamicFieldValue field={field} value={extraValues[field.code] ?? emptyFieldValue(field)} />
            </dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  )
}

function DeviceCardEditor({
  device,
  layout,
  tabItems,
  onTabChange,
}: {
  device: DeviceLookup
  layout: 'page' | 'sheet'
  tabItems: { id: DeviceTab; label: string; count?: number }[]
  onTabChange: (tab: DeviceTab) => void
}) {
  const update = useUpdateDevice(device.id)
  const queryClient = useQueryClient()
  const fieldsQuery = useDynamicFields(FieldEntity.Devices)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Devices, device.id)
  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const [extraValues, setExtraValues] = useState<Record<string, DynamicFieldValueData>>({})
  const extra = { ...(valuesQuery.data ?? {}), ...extraValues }

  const form = useForm<EditDeviceFormValues>({
    resolver: zodResolver(editDeviceSchema),
    defaultValues: {
      serialNumber: device.serialNumber,
      groupId: device.groupId ?? CLASSIFICATION_NONE,
      brandId: device.brandId ?? CLASSIFICATION_NONE,
      modelId: device.modelId ?? CLASSIFICATION_NONE,
      modificationId: device.modificationId ?? CLASSIFICATION_NONE,
    },
  })

  useSheetDirty(form.formState.isDirty || Object.keys(extraValues).length > 0, () =>
    runSheetFormSave(form.handleSubmit, persist),
  )

  async function persist(values: EditDeviceFormValues) {
    await update.mutateAsync({
      deviceId: device.id,
      serialNumber: values.serialNumber,
      groupId: emptyToNull(values.groupId),
      brandId: emptyToNull(values.brandId),
      modelId: emptyToNull(values.modelId),
      modificationId: emptyToNull(values.modificationId),
    })
    if (activeFields.length > 0) {
      await saveDynamicFieldValues(FieldEntity.Devices, device.id, filledFieldValues(activeFields, extra))
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.values(FieldEntity.Devices, device.id) })
    }
    form.reset(values)
    setExtraValues({})
    toast.success('Прибор сохранён')
  }

  async function onSubmit(values: EditDeviceFormValues) {
    try {
      await persist(values)
    } catch (error) {
      if (isDeviceDuplicateError(error)) {
        form.setError('serialNumber', { message: error.message })
        return
      }
      toast.error(getErrorMessage(error))
    }
  }

  const titleFields = <DeviceClassificationFields form={form} parts="title" appearance="header" />
  const serialField = (
    <FormField
      control={form.control}
      name="serialNumber"
      render={({ field }) => (
        <FormItem className="gap-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-1 text-sm text-muted-foreground">
            <span className="shrink-0 select-none">Серийный номер:</span>
            <FormControl>
              <InlineTextInput
                {...field}
                aria-label="Серийный номер"
                placeholder="—"
                className="text-sm text-muted-foreground md:text-sm"
              />
            </FormControl>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {layout === 'page' ? (
          <PageHeader title={titleFields} description={serialField} className="mb-0" />
        ) : (
          <div className="min-w-0 space-y-1">
            {titleFields}
            {serialField}
          </div>
        )}

        <PageTabs
          aria-label="Разделы карточки прибора"
          value="card"
          onChange={onTabChange}
          items={tabItems}
        />

        <SectionCard title="Карточка">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <DeviceClassificationFields form={form} parts="modification" />
              <FormItem>
                <FormLabel>Гарантия</FormLabel>
                <div className="flex h-9 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border border-input bg-muted px-3 text-sm shadow-xs dark:bg-input/30">
                  <WarrantyBadge warranty={device.warranty} />
                  {device.warranty ? (
                    <span className="truncate text-muted-foreground">
                      {formatDate(device.warranty.startsOn)} — {formatDate(device.warranty.endsOn)}
                    </span>
                  ) : null}
                </div>
              </FormItem>
            </div>

            {activeFields.length > 0 ? (
              <DynamicFieldsGrid className="gap-3">
                {activeFields.map((field) => (
                  <DynamicFieldRenderer
                    key={field.id}
                    field={field}
                    value={extra[field.code] ?? emptyFieldValue(field)}
                    onChange={(value) => setExtraValues((current) => ({ ...current, [field.code]: value }))}
                  />
                ))}
              </DynamicFieldsGrid>
            ) : null}

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label="Создан" value={formatDateTime(device.createdAt)} />
              <Info label="Обновлён" value={formatDateTime(device.updatedAt)} />
            </dl>
          </div>
        </SectionCard>
      </form>
    </Form>
  )
}

function WarrantiesSection({ warranties }: { warranties: DeviceWarranty[] }) {
  return (
    <SectionCard title="Гарантии" description="Текущие и прошлые периоды. Статус считается на сервере.">
      {warranties.length === 0 ? (
        <p className="text-sm text-muted-foreground">Гарантий ещё не было.</p>
      ) : (
        <ul className="space-y-3">
          {warranties.map((warranty) => (
            <li key={warranty.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-b-0">
              <div>
                <p className="text-sm">
                  {formatDate(warranty.startsOn)} — {formatDate(warranty.endsOn)}
                </p>
                {warranty.orderNumber ? (
                  <p className="text-xs text-muted-foreground">Заказ {warranty.orderNumber}</p>
                ) : null}
              </div>
              <WarrantyBadge warranty={warranty} />
            </li>
          ))}
        </ul>
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
