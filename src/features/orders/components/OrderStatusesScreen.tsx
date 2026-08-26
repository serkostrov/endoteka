import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { uniqueCode } from '@/lib/utils/code'
import { moveIndex } from '@/lib/utils/reorder'
import { cn } from '@/lib/utils'

import { OrderStatusEditor } from './OrderStatusEditor'
import {
  useDeleteOrderStatus,
  useDeleteOrderStatusGroup,
  useOrderStatusCatalog,
  useOrderStatusGroups,
  useReorderOrderStatusGroups,
  useReorderOrderStatuses,
  useUpsertOrderStatus,
  useUpsertOrderStatusGroup,
} from '../hooks/use-orders'
import {
  hexToRgba,
  mergeStatusGroups,
  statusBadgeStyle,
  type OrderStatusCatalogItem,
  type OrderStatusGroup,
} from '../lib/status-catalog'
import type { OrderStatusGroupRecord } from '../services/orders-service'

export function OrderStatusesScreen() {
  const canUpdate = useHasPermission(Permission.SettingsUpdate)
  const catalogQuery = useOrderStatusCatalog()
  const groupsQuery = useOrderStatusGroups()
  const saveStatus = useUpsertOrderStatus()
  const removeStatus = useDeleteOrderStatus()
  const saveGroup = useUpsertOrderStatusGroup()
  const removeGroup = useDeleteOrderStatusGroup()
  const reorderGroups = useReorderOrderStatusGroups()
  const reorderStatuses = useReorderOrderStatuses()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<OrderStatusCatalogItem | null>(null)
  const [defaultGroupId, setDefaultGroupId] = useState<string | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<OrderStatusCatalogItem | null>(null)
  const [groupOpen, setGroupOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<OrderStatusGroupRecord | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupColor, setGroupColor] = useState('#2563eb')
  const [deleteGroup, setDeleteGroup] = useState<OrderStatusGroupRecord | null>(null)
  const [groupDragIndex, setGroupDragIndex] = useState<number | null>(null)
  const [statusDrag, setStatusDrag] = useState<{ groupId: string; index: number } | null>(null)

  const items = catalogQuery.data ?? []
  const groupRecords = groupsQuery.data ?? []
  const grouped = mergeStatusGroups(items, groupRecords)
  const usedCodes = items.map((item) => item.code)
  const realGroupIds = new Set(groupRecords.map((item) => item.id))

  async function persistGroupOrder(nextGroups: OrderStatusGroup[]) {
    const ids = nextGroups.filter((group) => realGroupIds.has(group.id)).map((group) => group.id)
    if (ids.length !== groupRecords.length) {
      return
    }
    try {
      await reorderGroups.mutateAsync(ids)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function persistStatusOrder(nextGroups: OrderStatusGroup[]) {
    const ids = flattenStatusIds(nextGroups, items)
    if (ids.length !== items.length) {
      return
    }
    try {
      await reorderStatuses.mutateAsync(ids)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  function moveGroup(from: number, to: number) {
    if (from === to) {
      return
    }
    void persistGroupOrder(moveIndex(grouped, from, to))
  }

  function moveStatus(groupId: string, from: number, to: number) {
    if (from === to) {
      return
    }
    void persistStatusOrder(
      grouped.map((group) =>
        group.id === groupId ? { ...group, statuses: moveIndex(group.statuses, from, to) } : group,
      ),
    )
  }

  function openNewGroup() {
    setEditingGroup(null)
    setGroupName('')
    setGroupColor('#2563eb')
    setGroupOpen(true)
  }

  function openNewStatus(groupId?: string) {
    setEditing(null)
    setDefaultGroupId(groupId)
    setEditorOpen(true)
  }

  function openEditStatus(status: OrderStatusCatalogItem) {
    setEditing(status)
    setDefaultGroupId(status.groupId ?? undefined)
    setEditorOpen(true)
  }

  function openEditGroup(group: OrderStatusGroup) {
    const record = groupRecords.find((item) => item.id === group.id)
    if (!record) {
      return
    }
    setEditingGroup(record)
    setGroupName(record.name)
    setGroupColor(record.color)
    setGroupOpen(true)
  }

  if (catalogQuery.isLoading || groupsQuery.isLoading) {
    return <LoadingState label="Загрузка статусов" />
  }

  if (catalogQuery.error) {
    return (
      <ErrorState
        description={`${getErrorMessage(catalogQuery.error)} Примените SQL из supabase/migrations/20260828400000_order_status_catalog.sql.`}
      />
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Статусы заказов"
        description="Каждая группа — колонка на доске. Порядок групп и статусов меняется перетаскиванием."
      />

      {grouped.length === 0 ? (
        <EmptyState
          title="Групп нет"
          description="Добавьте первую группу — она станет колонкой доски."
          action={
            canUpdate ? (
              <Button type="button" onClick={openNewGroup}>
                <Plus className="size-4" />
                Группа
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {grouped.map((group, index) => (
            <StatusGroupCard
              key={group.id}
              group={group}
              index={index}
              groupCount={grouped.length}
              canUpdate={canUpdate}
              canReorder={canUpdate}
              dragging={groupDragIndex === index}
              groupDropEnabled={groupDragIndex !== null}
              onAddStatus={() => openNewStatus(group.id)}
              onEditGroup={() => openEditGroup(group)}
              onDeleteGroup={() => setDeleteGroup(groupRecords.find((item) => item.id === group.id) ?? null)}
              onEditStatus={openEditStatus}
              onDeleteStatus={setDeleteTarget}
              onGroupDragStart={() => setGroupDragIndex(index)}
              onGroupDragEnd={() => setGroupDragIndex(null)}
              onGroupDrop={() => {
                if (groupDragIndex === null) {
                  return
                }
                moveGroup(groupDragIndex, index)
                setGroupDragIndex(null)
              }}
              onMoveGroup={(direction) => moveGroup(index, index + direction)}
              statusDragIndex={statusDrag?.groupId === group.id ? statusDrag.index : null}
              statusDropEnabled={statusDrag?.groupId === group.id}
              onStatusDragStart={(statusIndex) => setStatusDrag({ groupId: group.id, index: statusIndex })}
              onStatusDragEnd={() => setStatusDrag(null)}
              onStatusDrop={(statusIndex) => {
                if (!statusDrag || statusDrag.groupId !== group.id) {
                  return
                }
                moveStatus(group.id, statusDrag.index, statusIndex)
                setStatusDrag(null)
              }}
              onMoveStatus={(statusIndex, direction) => moveStatus(group.id, statusIndex, statusIndex + direction)}
            />
          ))}
          {canUpdate ? (
            <button
              type="button"
              className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-dashed bg-card text-sm text-muted-foreground hover:bg-muted/40"
              onClick={openNewGroup}
            >
              <Plus className="size-4" />
              Добавить группу
            </button>
          ) : null}
        </div>
      )}

      <OrderStatusEditor
        open={editorOpen}
        item={editing}
        defaultGroupId={defaultGroupId}
        groups={groupRecords}
        usedCodes={usedCodes}
        isPending={saveStatus.isPending}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) {
            setEditing(null)
            setDefaultGroupId(undefined)
          }
        }}
        onSubmit={async (values) => {
          await saveStatus.mutateAsync({
            id: editing?.id,
            code: values.code,
            name: values.name,
            groupId: values.groupId,
            color: values.color,
            isInitial: values.isInitial,
            isTerminal: values.isTerminal,
            notifiesWarehouse: values.notifiesWarehouse,
            requiresWarranty: values.requiresWarranty,
            isDestructive: values.isDestructive,
            isActive: values.isActive,
          })
          toast.success('Статус сохранён')
          setEditing(null)
        }}
      />

      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Изменить группу' : 'Новая группа'}</DialogTitle>
            <DialogDescription>Группа становится колонкой на доске заказов.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="group-name">Название</Label>
              <Input id="group-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-color">Цвет колонки</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="group-color-picker"
                  type="color"
                  className="h-9 w-12 cursor-pointer p-1"
                  value={groupColor}
                  onChange={(event) => setGroupColor(event.target.value)}
                />
                <Input id="group-color" value={groupColor} onChange={(event) => setGroupColor(event.target.value)} />
                <span
                  className="size-9 shrink-0 rounded-md border"
                  style={{ backgroundColor: groupColor }}
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setGroupOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={saveGroup.isPending || !groupName.trim()}
              onClick={async () => {
                try {
                  await saveGroup.mutateAsync({
                    id: editingGroup?.id,
                    code: editingGroup?.code ?? uniqueCode(groupName, groupRecords.map((item) => item.code), 'group'),
                    name: groupName.trim(),
                    color: groupColor,
                  })
                  toast.success('Группа сохранена')
                  setGroupOpen(false)
                } catch (error) {
                  toast.error(getErrorMessage(error))
                }
              }}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        title="Удалить статус"
        description={
          deleteTarget
            ? `Статус «${deleteTarget.name}» будет удалён. Если по нему есть заказы, они перейдут на другой статус.`
            : ''
        }
        confirmLabel="Удалить"
        confirmVariant="destructive"
        isPending={removeStatus.isPending}
        onConfirm={async () => {
          if (!deleteTarget) {
            return
          }
          try {
            await removeStatus.mutateAsync(deleteTarget.id)
            toast.success('Статус удалён')
            setDeleteTarget(null)
          } catch (error) {
            toast.error(getErrorMessage(error))
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteGroup)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGroup(null)
          }
        }}
        title="Удалить группу"
        description={deleteGroup ? `Группа «${deleteGroup.name}» будет удалена.` : ''}
        confirmLabel="Удалить"
        confirmVariant="destructive"
        isPending={removeGroup.isPending}
        onConfirm={async () => {
          if (!deleteGroup) {
            return
          }
          try {
            await removeGroup.mutateAsync(deleteGroup.id)
            toast.success('Группа удалена')
            setDeleteGroup(null)
          } catch (error) {
            toast.error(getErrorMessage(error))
          }
        }}
      />
    </div>
  )
}

function StatusGroupCard({
  group,
  index,
  groupCount,
  canUpdate,
  canReorder,
  dragging,
  groupDropEnabled,
  onAddStatus,
  onEditGroup,
  onDeleteGroup,
  onEditStatus,
  onDeleteStatus,
  onGroupDragStart,
  onGroupDragEnd,
  onGroupDrop,
  onMoveGroup,
  statusDragIndex,
  statusDropEnabled,
  onStatusDragStart,
  onStatusDragEnd,
  onStatusDrop,
  onMoveStatus,
}: {
  group: OrderStatusGroup
  index: number
  groupCount: number
  canUpdate: boolean
  canReorder: boolean
  dragging: boolean
  groupDropEnabled: boolean
  onAddStatus: () => void
  onEditGroup: () => void
  onDeleteGroup: () => void
  onEditStatus: (status: OrderStatusCatalogItem) => void
  onDeleteStatus: (status: OrderStatusCatalogItem) => void
  onGroupDragStart: () => void
  onGroupDragEnd: () => void
  onGroupDrop: () => void
  onMoveGroup: (direction: -1 | 1) => void
  statusDragIndex: number | null
  statusDropEnabled: boolean
  onStatusDragStart: (index: number) => void
  onStatusDragEnd: () => void
  onStatusDrop: (index: number) => void
  onMoveStatus: (index: number, direction: -1 | 1) => void
}) {
  const tint = hexToRgba(group.color, 0.08)
  const isRealGroup = group.id !== '__other__'

  return (
    <section
      className={cn('overflow-hidden rounded-xl border bg-card', dragging && 'opacity-50')}
      style={{ borderColor: hexToRgba(group.color, 0.28) }}
      onDragOver={(event) => {
        if (!groupDropEnabled) {
          return
        }
        event.preventDefault()
      }}
      onDrop={(event) => {
        if (!groupDropEnabled) {
          return
        }
        event.preventDefault()
        onGroupDrop()
      }}
    >
      <header
        className="flex items-center justify-between gap-2 border-b px-3 py-2.5"
        style={{ backgroundColor: tint, borderColor: hexToRgba(group.color, 0.18) }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {canReorder && isRealGroup ? (
            <DragHandle
              label="Перетащить группу"
              onDragStart={onGroupDragStart}
              onDragEnd={onGroupDragEnd}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  if (index > 0) {
                    onMoveGroup(-1)
                  }
                }
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  if (index < groupCount - 1) {
                    onMoveGroup(1)
                  }
                }
              }}
            />
          ) : null}
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
          <h2 className="truncate text-sm font-semibold">{group.name}</h2>
          <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {group.statuses.length}
          </span>
        </div>
        {canUpdate ? (
          <div className="flex shrink-0 items-center gap-1">
            <IconActionButton label="Добавить статус" variant="ghost" onClick={onAddStatus}>
              <Plus className="size-3.5" />
            </IconActionButton>
            {isRealGroup ? (
              <>
                <IconActionButton label="Изменить группу" variant="ghost" onClick={onEditGroup}>
                  <Pencil className="size-3.5" />
                </IconActionButton>
                <IconActionButton
                  label={group.statuses.length > 0 ? 'Сначала удалите статусы' : 'Удалить группу'}
                  variant="ghost"
                  disabled={group.statuses.length > 0}
                  onClick={onDeleteGroup}
                >
                  <Trash2 className="size-3.5" />
                </IconActionButton>
              </>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="p-2">
        {group.statuses.length === 0 ? (
          <button
            type="button"
            disabled={!canUpdate}
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground hover:bg-muted/40 disabled:pointer-events-none"
            onClick={onAddStatus}
          >
            <Plus className="size-4" />
            Добавить статус
          </button>
        ) : (
          <ul className="space-y-1">
            {group.statuses.map((status, statusIndex) => (
              <li
                key={status.id}
                className={cn(statusDragIndex === statusIndex && 'opacity-50')}
                onDragOver={(event) => {
                  if (!statusDropEnabled) {
                    return
                  }
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onDrop={(event) => {
                  if (!statusDropEnabled) {
                    return
                  }
                  event.preventDefault()
                  event.stopPropagation()
                  onStatusDrop(statusIndex)
                }}
              >
                <div
                  className={cn(
                    'flex items-center gap-1 rounded-lg px-1 py-1.5',
                    canUpdate && 'hover:bg-muted/50',
                    !status.isActive && 'opacity-60',
                  )}
                >
                  {canReorder ? (
                    <DragHandle
                      label="Перетащить статус"
                      onDragStart={() => onStatusDragStart(statusIndex)}
                      onDragEnd={onStatusDragEnd}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          if (statusIndex > 0) {
                            onMoveStatus(statusIndex, -1)
                          }
                        }
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          if (statusIndex < group.statuses.length - 1) {
                            onMoveStatus(statusIndex, 1)
                          }
                        }
                      }}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-left"
                    disabled={!canUpdate}
                    onClick={() => onEditStatus(status)}
                  >
                    <StatusBadge
                      className="font-medium"
                      style={statusBadgeStyle(status.color || status.groupColor || group.color)}
                    >
                      {status.name}
                    </StatusBadge>
                    {statusFlags(status).map((flag) => (
                      <span
                        key={flag}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {flag}
                      </span>
                    ))}
                  </button>
                  {canUpdate ? (
                    <div className="flex shrink-0">
                      <IconActionButton label="Изменить" variant="ghost" onClick={() => onEditStatus(status)}>
                        <Pencil className="size-3.5" />
                      </IconActionButton>
                      <IconActionButton label="Удалить" variant="ghost" onClick={() => onDeleteStatus(status)}>
                        <Trash2 className="size-3.5" />
                      </IconActionButton>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
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

function flattenStatusIds(groups: OrderStatusGroup[], catalog: OrderStatusCatalogItem[]) {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const group of groups) {
    for (const status of group.statuses) {
      if (seen.has(status.id)) {
        continue
      }
      seen.add(status.id)
      ids.push(status.id)
    }
  }
  for (const item of catalog) {
    if (!seen.has(item.id)) {
      ids.push(item.id)
    }
  }
  return ids
}

function statusFlags(status: OrderStatusCatalogItem) {
  return [
    status.isInitial ? 'начальный' : null,
    status.isTerminal ? 'закрывает' : null,
    status.requiresWarranty ? 'гарантия' : null,
    status.isDestructive ? 'отказ' : null,
    status.notifiesWarehouse ? 'склад' : null,
    status.isActive ? null : 'скрыт',
  ].filter((item): item is string => Boolean(item))
}
