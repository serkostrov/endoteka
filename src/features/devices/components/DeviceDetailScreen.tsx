import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageTabs } from '@/components/shared/PageTabs'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { DynamicFieldRenderer, DynamicFieldValue, saveDynamicFieldValues } from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { useHasPermission } from '@/features/auth'
import { FieldEntity } from '@/lib/constants/fields'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { formatDate, formatDateTime } from '@/lib/utils/date'
import type { DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { DeviceClassificationFields } from './DeviceClassificationFields'
import { WarrantyBadge } from './WarrantyBadge'
import { CLASSIFICATION_NONE, classificationLabel, emptyToNull } from '../classification'
import { useDeleteDevice, useDeviceCard, useUpdateDevice } from '../hooks/use-devices'
import { deviceClassificationSchema, type DeviceClassificationFormValues } from '../schemas'
import type { DeviceCard, DeviceLookup, DeviceWarranty } from '../services/devices-service'

type DeviceTab = 'card' | 'orders' | 'history' | 'warranties'

export function DeviceDetailScreen() {
  const { id } = useParams()
  const cardQuery = useDeviceCard(id)

  if (cardQuery.isLoading) {
    return <LoadingState label="Загрузка прибора" />
  }

  if (cardQuery.error) {
    return <ErrorState description={getErrorMessage(cardQuery.error)} />
  }

  const card = cardQuery.data
  if (!card) {
    return <ErrorState description="Прибор не найден." />
  }

  return <DeviceCardBody card={card} />
}

function DeviceCardBody({ card }: { card: DeviceCard }) {
  const navigate = useNavigate()
  const canDelete = useHasPermission(Permission.DevicesDelete)
  const remove = useDeleteDevice()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [tab, setTab] = useState<DeviceTab>('card')
  const device = card.device
  const orders = device.repairs
  const pastRepairs = orders.filter((item) => item.statusCode === 'issued' || item.statusCode === 'cancelled')

  async function handleDelete() {
    try {
      await remove.mutateAsync(device.id)
      toast.success('Прибор удалён')
      setDeleteOpen(false)
      navigate(routes.devices)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={device.serialNumber}
        description={classificationLabel(device)}
        actions={
          canDelete ? (
            <IconActionButton
              label="Удалить"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
            </IconActionButton>
          ) : undefined
        }
      />

      <PageTabs
        aria-label="Разделы карточки прибора"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'card', label: 'Карточка' },
          { id: 'orders', label: 'Заказы', count: orders.length },
          { id: 'history', label: 'История', count: pastRepairs.length },
          { id: 'warranties', label: 'Гарантии', count: card.warranties.length },
        ]}
      />

      {tab === 'card' ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Идентификация">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Info label="Серийный номер" value={device.serialNumber} />
                <Info label="Создан" value={formatDateTime(device.createdAt)} />
                <Info label="Обновлён" value={formatDateTime(device.updatedAt)} />
              </dl>
            </SectionCard>

            <SectionCard title="Текущая гарантия">
              <WarrantyBadge warranty={device.warranty} />
              {device.warranty ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {formatDate(device.warranty.startsOn)} — {formatDate(device.warranty.endsOn)}
                  {device.warranty.orderNumber ? ` · заказ ${device.warranty.orderNumber}` : ''}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">Гарантия появляется при выдаче заказа.</p>
              )}
            </SectionCard>
          </div>

          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <ClassificationSection deviceId={device.id} device={device} />
            <DeviceFieldsSection deviceId={device.id} />
          </div>
        </div>
      ) : null}

      {tab === 'orders' ? (
        <SectionCard title="Заказы" description="Все ремонты этого серийного номера, независимо от текущего клиента.">
          <DataTable
            caption="Заказы прибора"
            data={orders}
            getRowId={(row) => row.id}
            emptyTitle="Заказов нет"
            emptyDescription="По этому серийному номеру ещё не было ремонтов."
            onRowClick={(row) => navigate(routes.order.replace(':id', row.id))}
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
                    <Link className="font-medium hover:underline" to={routes.order.replace(':id', repair.id)}>
                      {repair.number}
                    </Link>
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

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить прибор"
        description={`${device.serialNumber} будет удалён. Если по нему есть заказы, удаление не пройдёт.`}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}

function ClassificationSection({ deviceId, device }: { deviceId: string; device: DeviceLookup }) {
  const canUpdate = useHasPermission(Permission.DevicesUpdate)
  const [editing, setEditing] = useState(false)

  return (
    <SectionCard
      title="Классификация"
      description="Группа, бренд, модель и модификация из справочников."
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
        <ClassificationEditForm deviceId={deviceId} device={device} onDone={() => setEditing(false)} />
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Группа" value={device.groupName} />
          <Info label="Бренд" value={device.brandName} />
          <Info label="Модель" value={device.modelName} />
          <Info label="Модификация" value={device.modificationName} />
        </dl>
      )}
    </SectionCard>
  )
}

function ClassificationEditForm({
  deviceId,
  device,
  onDone,
}: {
  deviceId: string
  device: DeviceLookup
  onDone: () => void
}) {
  const update = useUpdateDevice(deviceId)
  const form = useForm<DeviceClassificationFormValues>({
    resolver: zodResolver(deviceClassificationSchema),
    defaultValues: {
      groupId: device.groupId ?? CLASSIFICATION_NONE,
      brandId: device.brandId ?? CLASSIFICATION_NONE,
      modelId: device.modelId ?? CLASSIFICATION_NONE,
      modificationId: device.modificationId ?? CLASSIFICATION_NONE,
    },
  })

  async function onSubmit(values: DeviceClassificationFormValues) {
    try {
      await update.mutateAsync({
        deviceId,
        groupId: emptyToNull(values.groupId),
        brandId: emptyToNull(values.brandId),
        modelId: emptyToNull(values.modelId),
        modificationId: emptyToNull(values.modificationId),
      })
      toast.success('Классификация сохранена')
      onDone()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <DeviceClassificationFields form={form} />
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

function DeviceFieldsSection({ deviceId }: { deviceId: string }) {
  const canUpdate = useHasPermission(Permission.DevicesUpdate)
  const fieldsQuery = useDynamicFields(FieldEntity.Devices)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Devices, deviceId)
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
        title="Дополнительные сведения"
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
      await saveDynamicFieldValues(FieldEntity.Devices, deviceId, extraValues)
      setExtraDraft(null)
      setEditing(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.values(FieldEntity.Devices, deviceId) })
      toast.success('Поля прибора сохранены')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Дополнительные сведения"
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
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
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
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {activeFields.map((field) => (
            <div key={field.id}>
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
