import { type KeyboardEvent, useState } from 'react'
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { moveIndex } from '@/lib/utils/reorder'
import { cn } from '@/lib/utils'

import {
  useDeleteDeviceCompatiblePartGroup,
  useDeviceCompatiblePartGroups,
  useReorderDeviceCompatiblePartGroups,
  useUpsertDeviceCompatiblePartGroup,
} from '../hooks/use-compatible-parts'
import type { CompatiblePartGroup } from '../services/compatible-parts-service'

const DEFAULT_GROUP_COLOR = '#2563eb'
const GROUP_COLORS = [
  DEFAULT_GROUP_COLOR,
  '#0891b2',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#db2777',
] as const

export function CompatiblePartGroupsScreen() {
  const canUpdate = useHasPermission(Permission.SettingsUpdate)
  const groupsQuery = useDeviceCompatiblePartGroups()
  const saveGroup = useUpsertDeviceCompatiblePartGroup()
  const deleteGroup = useDeleteDeviceCompatiblePartGroup()
  const reorderGroups = useReorderDeviceCompatiblePartGroups()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CompatiblePartGroup | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_GROUP_COLOR)
  const [deleteTarget, setDeleteTarget] = useState<CompatiblePartGroup | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const groups = groupsQuery.data ?? []

  function openCreate() {
    setEditing(null)
    setName('')
    setColor(GROUP_COLORS[groups.length % GROUP_COLORS.length] ?? DEFAULT_GROUP_COLOR)
    setDialogOpen(true)
  }

  function openEdit(group: CompatiblePartGroup) {
    setEditing(group)
    setName(group.name)
    setColor(group.color)
    setDialogOpen(true)
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Укажите название группы')
      return
    }
    try {
      await saveGroup.mutateAsync({ id: editing?.id, name: trimmed, color })
      toast.success(editing ? 'Группа сохранена' : 'Группа создана')
      setDialogOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function persistOrder(next: CompatiblePartGroup[]) {
    try {
      await reorderGroups.mutateAsync(next.map((group) => group.id))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  function moveGroup(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= groups.length || to >= groups.length) {
      return
    }
    void persistOrder(moveIndex(groups, from, to))
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Группы запасных частей"
        description="Единый набор разделов для карточек всех приборов. Порядок деталей на каждом приборе настраивается отдельно."
        actions={
          canUpdate ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4" />
              Добавить группу
            </Button>
          ) : undefined
        }
      />

      {groupsQuery.isLoading ? (
        <LoadingState label="Загрузка групп" />
      ) : groupsQuery.error ? (
        <ErrorState description={getErrorMessage(groupsQuery.error)} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Групп пока нет"
          description="Создайте разделы — например, «Рукоять» или «Вводимая трубка» — они появятся на всех карточках приборов."
          action={
            canUpdate ? (
              <Button type="button" onClick={openCreate}>
                <Plus className="size-4" />
                Создать группу
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ul className="divide-y">
            {groups.map((group, index) => (
              <li
                key={group.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 transition-colors',
                  dragIndex === index && 'opacity-50',
                  canUpdate && 'hover:bg-muted/40',
                )}
                style={{ borderLeftWidth: 3, borderLeftColor: group.color }}
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
                  moveGroup(dragIndex, index)
                  setDragIndex(null)
                }}
              >
                {canUpdate ? (
                  <DragHandle
                    label="Перетащить группу"
                    onDragStart={() => setDragIndex(index)}
                    onDragEnd={() => setDragIndex(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' && index > 0) {
                        event.preventDefault()
                        moveGroup(index, index - 1)
                      }
                      if (event.key === 'ArrowDown' && index < groups.length - 1) {
                        event.preventDefault()
                        moveGroup(index, index + 1)
                      }
                    }}
                  />
                ) : (
                  <span className="size-6 shrink-0" />
                )}

                <span
                  className="size-3 shrink-0 rounded-full shadow-sm ring-1 ring-black/5"
                  style={{ backgroundColor: group.color }}
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{group.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.partCount === 0
                      ? 'Пока не используется'
                      : `${group.partCount} ${pluralParts(group.partCount)} на приборах`}
                  </p>
                </div>

                {canUpdate ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <IconActionButton
                      label="Изменить"
                      variant="ghost"
                      onClick={() => openEdit(group)}
                    >
                      <Pencil className="size-3.5" />
                    </IconActionButton>
                    <IconActionButton
                      label={
                        group.partCount > 0
                          ? 'Сначала уберите детали с карточек'
                          : 'Удалить группу'
                      }
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={group.partCount > 0}
                      onClick={() => setDeleteTarget(group)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconActionButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Изменить группу' : 'Новая группа'}</DialogTitle>
            <DialogDescription>
              Группа будет доступна на вкладке «Запасные части» у всех приборов.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="global-group-name">Название</Label>
              <Input
                id="global-group-name"
                value={name}
                placeholder="Например, рукоять или вводимая трубка"
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleSave()
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Цвет</Label>
              <div className="flex flex-wrap items-center gap-2">
                {GROUP_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Цвет ${swatch}`}
                    className={cn(
                      'size-7 rounded-md border transition-transform',
                      color.toLowerCase() === swatch.toLowerCase() &&
                        'scale-110 ring-2 ring-ring ring-offset-2',
                    )}
                    style={{ backgroundColor: swatch }}
                    onClick={() => setColor(swatch)}
                  />
                ))}
                <Input
                  type="color"
                  className="h-9 w-12 cursor-pointer p-1"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </div>
            </div>

            <div
              className="rounded-lg border px-3 py-2.5"
              style={{
                borderColor: hexToRgba(color, 0.35),
                backgroundColor: hexToRgba(color, 0.08),
              }}
            >
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm font-semibold">{name.trim() || 'Название группы'}</span>
                <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  0
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Так группа выглядит на карточке прибора</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={saveGroup.isPending || !name.trim()}
              onClick={() => {
                void handleSave()
              }}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить группу"
        description={
          deleteTarget
            ? `Группа «${deleteTarget.name}» будет удалена из справочника.`
            : ''
        }
        confirmLabel="Удалить"
        isPending={deleteGroup.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        onConfirm={() => {
          if (!deleteTarget) {
            return
          }
          void (async () => {
            try {
              await deleteGroup.mutateAsync(deleteTarget.id)
              toast.success('Группа удалена')
              setDeleteTarget(null)
            } catch (error) {
              toast.error(getErrorMessage(error))
            }
          })()
        }}
      />
    </div>
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

function pluralParts(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return 'связь'
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'связи'
  }
  return 'связей'
}

function hexToRgba(value: string, alpha: number) {
  const hex = value.replace('#', '')
  if (hex.length !== 6) {
    return `rgba(37, 99, 235, ${alpha})`
  }
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
