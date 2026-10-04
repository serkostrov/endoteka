import { useMemo } from 'react'
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
import { useDeviceCompatiblePartGroups, useDeviceCompatibleParts } from '../hooks/use-compatible-parts'
import type { CompatiblePart } from '../services/compatible-parts-service'

type DeviceCompatiblePartsReadonlyProps = {
  modelId: string | null | undefined
  modificationId: string | null | undefined
}

/** Запасные части с вида прибора (модификация → модель), только просмотр. */
export function DeviceCompatiblePartsReadonly({
  modelId,
  modificationId,
}: DeviceCompatiblePartsReadonlyProps) {
  const openSheet = useOpenEntitySheet()
  const referenceItemId = resolveTypeReferenceId(modelId, modificationId)
  const groupsQuery = useDeviceCompatiblePartGroups(referenceItemId)
  const partsQuery = useDeviceCompatibleParts(referenceItemId)
  const groups = groupsQuery.data ?? []
  const parts = partsQuery.data ?? []

  const partsByGroup = useMemo(() => {
    const map = new Map<string, CompatiblePart[]>()
    for (const group of groups) {
      map.set(group.id, [])
    }
    for (const part of parts) {
      const list = map.get(part.groupId) ?? []
      list.push(part)
      map.set(part.groupId, list)
    }
    return map
  }, [groups, parts])

  return (
    <SectionCard title="Запасные части" description="Запчасти с вида прибора.">
      {!referenceItemId ? (
        <EmptyState
          title="Вид не указан"
          description="Укажите модель или модификацию."
          className="py-12"
        />
      ) : groupsQuery.isLoading || partsQuery.isLoading ? (
        <LoadingState label="Загрузка деталей" className="min-h-24 py-6" />
      ) : groupsQuery.error || partsQuery.error ? (
        <ErrorState
          description={getErrorMessage(groupsQuery.error ?? partsQuery.error)}
        />
      ) : parts.length === 0 ? (
        <EmptyState
          title="Запасных частей нет"
          description="Для этого вида ещё не указали запчасти."
          className="py-12"
        />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const groupParts = partsByGroup.get(group.id) ?? []
            if (groupParts.length === 0) {
              return null
            }
            return (
              <section
                key={group.id}
                className="overflow-hidden rounded-lg border bg-card"
                style={{ borderColor: hexToRgba(group.color, 0.28) }}
              >
                <header
                  className="flex items-center gap-2 border-b px-2.5 py-2"
                  style={{
                    backgroundColor: hexToRgba(group.color, 0.08),
                    borderColor: hexToRgba(group.color, 0.18),
                  }}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  <h3 className="truncate text-xs font-semibold tracking-tight">{group.name}</h3>
                  <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {groupParts.length}
                  </span>
                </header>
                <ul className="divide-y">
                  {groupParts.map((part) => (
                    <ReadonlyPartRow
                      key={part.id}
                      part={part}
                      onOpen={() => openSheet('item', part.id)}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
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

function ReadonlyPartRow({
  part,
  onOpen,
}: {
  part: CompatiblePart
  onOpen: () => void
}) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/60"
        onClick={onOpen}
      >
        <InventoryItemCoverThumb src={part.coverUrl} alt={part.name} className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium leading-snug">{part.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
            {part.article ? <span>арт. {part.article}</span> : null}
            {part.code ? <span className="font-mono">{part.code}</span> : null}
            {part.categoryName ? <span>{part.categoryName}</span> : null}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span
            className={cn(
              'block text-xs font-medium tabular-nums',
              part.stockQuantity <= 0 && 'text-muted-foreground',
            )}
          >
            {formatQuantity(part.stockQuantity)}
            {part.unitName ? ` ${part.unitName}` : ''}
          </span>
          <span className="text-[10px] text-muted-foreground">на складе</span>
        </span>
        <ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-40" />
      </button>
    </li>
  )
}

function resolveTypeReferenceId(
  modelId: string | null | undefined,
  modificationId: string | null | undefined,
) {
  return emptyToNull(modificationId ?? '') ?? emptyToNull(modelId ?? '')
}

function hexToRgba(color: string, alpha: number) {
  const hex = color.replace('#', '')
  if (hex.length !== 6) {
    return `rgba(37, 99, 235, ${alpha})`
  }
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
