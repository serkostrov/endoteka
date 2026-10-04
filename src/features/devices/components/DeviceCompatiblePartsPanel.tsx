import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import { ChevronRight, GripVertical, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { useOpenEntitySheet } from '@/app/sheet-stack'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InventoryItemCoverThumb } from '@/features/inventory/components/InventoryItemCoverThumb'
import { ItemSearchField } from '@/features/inventory/components/ItemSearchField'
import type { InventoryItem } from '@/features/inventory/services/inventory-service'
import { formatQuantity } from '@/lib/constants/inventory'
import { getErrorMessage } from '@/lib/errors'
import { moveIndex } from '@/lib/utils/reorder'
import { cn } from '@/lib/utils'

import {
  useAddDeviceCompatiblePart,
  useDeviceCompatiblePartGroups,
  useDeviceCompatibleParts,
  useRemoveDeviceCompatiblePart,
  useReorderDeviceCompatibleParts,
} from '../hooks/use-compatible-parts'
import type { CompatiblePart, CompatiblePartGroup } from '../services/compatible-parts-service'

type DeviceCompatiblePartsPanelProps = {
  referenceItemId: string
  canUpdate: boolean
}

export function DeviceCompatiblePartsPanel({
  referenceItemId,
  canUpdate,
}: DeviceCompatiblePartsPanelProps) {
  const openSheet = useOpenEntitySheet()
  const groupsQuery = useDeviceCompatiblePartGroups(referenceItemId)
  const partsQuery = useDeviceCompatibleParts(referenceItemId)
  const addPart = useAddDeviceCompatiblePart(referenceItemId)
  const removePart = useRemoveDeviceCompatiblePart(referenceItemId)
  const reorderParts = useReorderDeviceCompatibleParts(referenceItemId)

  const [adding, setAdding] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [dragPart, setDragPart] = useState<{ groupId: string; index: number } | null>(null)

  const groups = groupsQuery.data ?? []
  const parts = partsQuery.data ?? []
  const linkedIds = useMemo(() => new Set(parts.map((part) => part.id)), [parts])

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

  useEffect(() => {
    if (!selectedGroupId && groups[0]) {
      setSelectedGroupId(groups[0].id)
      return
    }
    if (selectedGroupId && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id ?? '')
    }
  }, [groups, selectedGroupId])

  async function handleAdd(item: InventoryItem) {
    if (linkedIds.has(item.id)) {
      toast.message('Эта деталь уже в списке')
      return
    }
    if (groups.length === 0) {
      toast.message('Сначала настройте группы в настройках')
      return
    }
    if (!selectedGroupId) {
      toast.error('Выберите группу')
      return
    }
    try {
      await addPart.mutateAsync({ itemId: item.id, groupId: selectedGroupId })
      toast.success('Деталь добавлена')
      setAdding(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleRemove(part: CompatiblePart) {
    try {
      await removePart.mutateAsync(part.id)
      toast.success('Деталь убрана')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function persistPartOrder(groupId: string, nextParts: CompatiblePart[]) {
    try {
      await reorderParts.mutateAsync({
        groupId,
        linkIds: nextParts.map((part) => part.linkId),
      })
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  function movePart(groupId: string, from: number, to: number) {
    const current = partsByGroup.get(groupId) ?? []
    if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) {
      return
    }
    void persistPartOrder(groupId, moveIndex(current, from, to))
  }

  const isLoading = groupsQuery.isLoading || partsQuery.isLoading
  const error = groupsQuery.error ?? partsQuery.error

  return (
    <SectionCard
      title="Запасные части"
      description="Запчасти из номенклатуры. Группы общие для всех приборов."
      actions={
        canUpdate ? (
          <Button
            type="button"
            variant={adding ? 'secondary' : 'outline'}
            size="sm"
            className="shrink-0"
            onClick={() => {
              if (!adding && groups.length === 0) {
                toast.message('Сначала настройте группы в параметрах')
                return
              }
              setAdding((value) => !value)
            }}
          >
            {adding ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {adding ? 'Закрыть' : 'Добавить'}
          </Button>
        ) : null
      }
    >
      <div className="space-y-3">
        {adding ? (
          <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-1.5">
              <Label htmlFor={`compatible-group-${referenceItemId}`}>Группа</Label>
              <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger id={`compatible-group-${referenceItemId}`} className="w-full">
                  <SelectValue placeholder="Выберите группу" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: group.color }}
                        />
                        {group.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ItemSearchField
              searchPlaceholder="Найти деталь в номенклатуре"
              showScan={false}
              suggestSide="bottom"
              onSelect={(item) => {
                void handleAdd(item)
              }}
            />
          </div>
        ) : null}

        {isLoading ? (
          <LoadingState label="Загрузка деталей" className="min-h-24 py-6" />
        ) : error ? (
          <ErrorState description={getErrorMessage(error)} />
        ) : groups.length === 0 ? (
          <EmptyState
            title="Группы не настроены"
            description="Создайте единые группы запасных частей в параметрах — они появятся на всех приборах."
            className="py-12"
          />
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const groupParts = partsByGroup.get(group.id) ?? []
              return (
                <CompatiblePartGroupCard
                  key={group.id}
                  group={group}
                  parts={groupParts}
                  canUpdate={canUpdate}
                  dragIndex={dragPart?.groupId === group.id ? dragPart.index : null}
                  onOpenPart={(partId) => openSheet('item', partId)}
                  onRemovePart={(part) => {
                    void handleRemove(part)
                  }}
                  onDragStart={(index) => setDragPart({ groupId: group.id, index })}
                  onDragEnd={() => setDragPart(null)}
                  onDrop={(index) => {
                    if (!dragPart || dragPart.groupId !== group.id) {
                      return
                    }
                    movePart(group.id, dragPart.index, index)
                    setDragPart(null)
                  }}
                  onMovePart={(index, direction) => {
                    movePart(group.id, index, index + direction)
                  }}
                />
              )
            })}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function CompatiblePartGroupCard({
  group,
  parts,
  canUpdate,
  dragIndex,
  onOpenPart,
  onRemovePart,
  onDragStart,
  onDragEnd,
  onDrop,
  onMovePart,
}: {
  group: CompatiblePartGroup
  parts: CompatiblePart[]
  canUpdate: boolean
  dragIndex: number | null
  onOpenPart: (partId: string) => void
  onRemovePart: (part: CompatiblePart) => void
  onDragStart: (index: number) => void
  onDragEnd: () => void
  onDrop: (index: number) => void
  onMovePart: (index: number, direction: -1 | 1) => void
}) {
  const tint = hexToRgba(group.color, 0.08)

  return (
    <section
      className="overflow-hidden rounded-lg border bg-card"
      style={{ borderColor: hexToRgba(group.color, 0.28) }}
    >
      <header
        className="flex items-center justify-between gap-2 border-b px-2.5 py-2"
        style={{ backgroundColor: tint, borderColor: hexToRgba(group.color, 0.18) }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
          <h3 className="truncate text-xs font-semibold tracking-tight">{group.name}</h3>
          <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {parts.length}
          </span>
        </div>
      </header>

      {parts.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">В группе пока нет деталей</p>
      ) : (
        <ul className="divide-y">
          {parts.map((part, index) => (
            <li
              key={part.id}
              className={cn('group relative', dragIndex === index && 'opacity-50')}
              onDragOver={(event) => {
                if (!canUpdate || dragIndex === null) {
                  return
                }
                event.preventDefault()
              }}
              onDrop={(event) => {
                if (!canUpdate || dragIndex === null) {
                  return
                }
                event.preventDefault()
                onDrop(index)
              }}
            >
              <div className="flex items-center gap-1 px-1.5 py-1.5">
                {canUpdate ? (
                  <DragHandle
                    label="Перетащить деталь"
                    onDragStart={() => onDragStart(index)}
                    onDragEnd={onDragEnd}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        if (index > 0) {
                          onMovePart(index, -1)
                        }
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        if (index < parts.length - 1) {
                          onMovePart(index, 1)
                        }
                      }
                    }}
                  />
                ) : null}
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/60"
                  onClick={() => onOpenPart(part.id)}
                >
                  <InventoryItemCoverThumb
                    src={part.coverUrl}
                    alt={part.name}
                    className="size-8"
                  />
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
                {canUpdate ? (
                  <IconActionButton
                    label="Убрать"
                    size="icon-sm"
                    className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 text-destructive hover:text-destructive"
                    onClick={() => onRemovePart(part)}
                  >
                    <Trash2 />
                  </IconActionButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DragHandle({
  label,
  onDragStart,
  onDragEnd,
  onKeyDown,
}: {
  label: string
  onDragStart: () => void
  onDragEnd: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      draggable
      aria-label={label}
      className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted/80 active:cursor-grabbing"
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', label)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
    >
      <GripVertical className="size-3.5" />
    </button>
  )
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
