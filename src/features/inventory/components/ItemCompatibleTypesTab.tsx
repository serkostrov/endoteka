import { useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import {
  DeviceTypeSearchField,
  type DeviceTypePick,
} from '@/features/devices/components/DeviceTypeSearchField'
import {
  useInventoryItemCompatibleTypes,
  useLinkInventoryItemCompatibleType,
  useUnlinkInventoryItemCompatibleType,
} from '@/features/devices/hooks/use-compatible-parts'
import type { CompatibleDeviceType } from '@/features/devices/services/compatible-parts-service'
import { InventoryItemCoverThumb } from '@/features/inventory/components/InventoryItemCoverThumb'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

type ItemCompatibleTypesTabProps = {
  itemId: string
}

export function ItemCompatibleTypesTab({ itemId }: ItemCompatibleTypesTabProps) {
  const canUpdate = useHasPermission(Permission.SettingsUpdate)
  const typesQuery = useInventoryItemCompatibleTypes(itemId)
  const linkType = useLinkInventoryItemCompatibleType(itemId)
  const unlinkType = useUnlinkInventoryItemCompatibleType(itemId)
  const [adding, setAdding] = useState(false)
  const linkedIds = useMemo(
    () => new Set((typesQuery.data ?? []).map((row) => row.id)),
    [typesQuery.data],
  )

  async function handleAdd(pick: DeviceTypePick) {
    if (linkedIds.has(pick.id)) {
      toast.message('Этот вид уже в списке')
      return
    }
    try {
      await linkType.mutateAsync(pick.id)
      toast.success('Прибор добавлен')
      setAdding(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleRemove(row: CompatibleDeviceType) {
    try {
      await unlinkType.mutateAsync(row.id)
      toast.success('Прибор убран')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const types = typesQuery.data ?? []

  return (
    <SectionCard
      title="Совместимость"
      description="Виды приборов для этой детали."
      actions={
        canUpdate ? (
          <Button
            type="button"
            variant={adding ? 'secondary' : 'outline'}
            size="sm"
            className="shrink-0"
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {adding ? 'Закрыть' : 'Добавить'}
          </Button>
        ) : null
      }
    >
      <div className="space-y-3">
        {adding ? (
          <div className="rounded-lg border bg-muted/30 p-3">
            <DeviceTypeSearchField
              excludeIds={linkedIds}
              suggestSide="bottom"
              searchPlaceholder="Найти модель или модификацию"
              onSelect={(pick) => {
                void handleAdd(pick)
              }}
            />
          </div>
        ) : null}

        {typesQuery.isLoading ? (
          <LoadingState label="Загрузка приборов" className="min-h-24 py-6" />
        ) : typesQuery.error ? (
          <ErrorState description={getErrorMessage(typesQuery.error)} />
        ) : types.length === 0 ? (
          <EmptyState
            title="Подходящих приборов нет"
            description={
              canUpdate ? 'Добавьте виды приборов.' : 'Для этой детали ещё не указали виды.'
            }
            className="py-12"
          />
        ) : (
          <ul className="overflow-hidden rounded-lg border divide-y">
            {types.map((row) => (
              <li key={row.id} className="group relative">
                <div className="flex w-full items-center gap-3 px-3 py-2.5">
                  <InventoryItemCoverThumb src={row.coverUrl} alt={row.name} className="size-11" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      {row.setName ? <span>{row.setName}</span> : null}
                      {row.pathLabel && row.pathLabel !== row.name ? (
                        <span className="truncate">{row.pathLabel}</span>
                      ) : null}
                      {row.code ? <span className="font-mono">{row.code}</span> : null}
                    </span>
                  </span>
                </div>
                {canUpdate ? (
                  <div className="absolute top-1/2 right-3 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <IconActionButton
                      label="Убрать"
                      size="icon-sm"
                      className="bg-card text-destructive shadow-sm hover:text-destructive"
                      disabled={unlinkType.isPending}
                      onClick={() => {
                        void handleRemove(row)
                      }}
                    >
                      <Trash2 />
                    </IconActionButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}
