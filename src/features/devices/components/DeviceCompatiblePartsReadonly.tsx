import { ChevronRight } from 'lucide-react'

import { useOpenEntitySheet } from '@/app/sheet-stack'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { InventoryItemCoverThumb } from '@/features/inventory/components/InventoryItemCoverThumb'
import { formatQuantity } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { emptyToNull } from '../classification'
import { useDeviceCompatibleParts } from '../hooks/use-compatible-parts'

type DeviceCompatiblePartsReadonlyProps = {
  modelId: string | null | undefined
  modificationId: string | null | undefined
}

/** Подходящие детали с вида прибора (модификация → модель), только просмотр. */
export function DeviceCompatiblePartsReadonly({
  modelId,
  modificationId,
}: DeviceCompatiblePartsReadonlyProps) {
  const openSheet = useOpenEntitySheet()
  const referenceItemId = resolveTypeReferenceId(modelId, modificationId)
  const partsQuery = useDeviceCompatibleParts(referenceItemId)
  const parts = partsQuery.data ?? []

  return (
    <SectionCard title="Подходящее" description="Запчасти с вида прибора.">
      {!referenceItemId ? (
        <EmptyState
          title="Вид не указан"
          description="Укажите модель или модификацию."
          className="py-12"
        />
      ) : partsQuery.isLoading ? (
        <LoadingState label="Загрузка деталей" className="min-h-24 py-6" />
      ) : partsQuery.error ? (
        <ErrorState description={getErrorMessage(partsQuery.error)} />
      ) : parts.length === 0 ? (
        <EmptyState
          title="Подходящих деталей нет"
          description="Для этого вида ещё не указали запчасти."
          className="py-12"
        />
      ) : (
        <ul className="overflow-hidden rounded-lg border divide-y">
          {parts.map((part) => (
            <li key={part.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
                onClick={() => openSheet('item', part.id)}
              >
                <InventoryItemCoverThumb src={part.coverUrl} alt={part.name} className="size-11" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{part.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {part.article ? <span>арт. {part.article}</span> : null}
                    {part.code ? <span className="font-mono">{part.code}</span> : null}
                    {part.categoryName ? <span>{part.categoryName}</span> : null}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={cn(
                      'block text-sm font-medium tabular-nums',
                      part.stockQuantity <= 0 && 'text-muted-foreground',
                    )}
                  >
                    {formatQuantity(part.stockQuantity)}
                    {part.unitName ? ` ${part.unitName}` : ''}
                  </span>
                  <span className="text-[11px] text-muted-foreground">на складе</span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-40" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

export function useDeviceTypeCompatiblePartsCount(
  modelId: string | null | undefined,
  modificationId: string | null | undefined,
) {
  const referenceItemId = resolveTypeReferenceId(modelId, modificationId)
  const partsQuery = useDeviceCompatibleParts(referenceItemId)
  return partsQuery.data?.length ?? 0
}

function resolveTypeReferenceId(
  modelId: string | null | undefined,
  modificationId: string | null | undefined,
) {
  return emptyToNull(modificationId ?? '') ?? emptyToNull(modelId ?? '')
}
