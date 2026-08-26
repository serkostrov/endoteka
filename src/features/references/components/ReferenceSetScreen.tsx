import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { ReferenceSetCode } from '@/lib/constants/references'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { uniqueCode } from '@/lib/utils/code'
import { moveIndex } from '@/lib/utils/reorder'

import { ReferenceItemDialog } from './ReferenceItemDialog'
import {
  useReferenceItemUsage,
  useReferenceItems,
  useReferenceSets,
  useReorderReferenceItems,
  useSetReferenceItemActive,
  useUpsertReferenceItem,
  useDeleteReferenceItem,
} from '../hooks/use-references'
import type { ReferenceItemFormValues } from '../schemas'
import type { ReferenceItem } from '../services/references-service'

export function ReferenceSetScreen() {
  const { setId } = useParams()
  const canUpdate = useHasPermission(Permission.SettingsUpdate)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ReferenceItem | null>(null)
  const [statusTarget, setStatusTarget] = useState<ReferenceItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReferenceItem | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const setsQuery = useReferenceSets()
  const itemsQuery = useReferenceItems(setId)
  const set = setsQuery.data?.find((item) => item.id === setId)
  const parentItemsQuery = useReferenceItems(set?.parentSetId ?? undefined)
  const save = useUpsertReferenceItem(setId ?? '')
  const setActive = useSetReferenceItemActive(setId ?? '')
  const remove = useDeleteReferenceItem(setId ?? '')
  const reorder = useReorderReferenceItems(setId ?? '')
  const usageQuery = useReferenceItemUsage(statusTarget?.id ?? deleteTarget?.id)
  const nextActive = statusTarget ? !statusTarget.isActive : false

  const items = itemsQuery.data ?? []
  const visibleItems = items.filter((item) => {
    const haystack = `${item.name} ${item.code} ${item.parentName ?? ''}`.toLowerCase()
    const matchesSearch = haystack.includes(search.trim().toLowerCase())
    const matchesStatus =
      status === 'all' || (status === 'active' ? item.isActive : !item.isActive)
    return matchesSearch && matchesStatus
  })

  if (set?.code === ReferenceSetCode.OrderStatuses) {
    return <Navigate to={routes.settingsOrderStatuses} replace />
  }

  if (setsQuery.isLoading || itemsQuery.isLoading) {
    return <LoadingState label="Загружаем справочник…" />
  }

  if (itemsQuery.error) {
    return <ErrorState description={getErrorMessage(itemsQuery.error)} />
  }

  if (!setId || !set) {
    return (
      <ErrorState
        title="Справочник не найден"
        description="Проверьте адрес или вернитесь к списку справочников."
        action={
          <Button asChild variant="outline">
            <Link to={routes.settingsReferences}>К справочникам</Link>
          </Button>
        }
      />
    )
  }

  const currentSet = set
  const parentOptions = (parentItemsQuery.data ?? []).filter(
    (item) => item.isActive || item.id === editingItem?.parentId,
  )

  async function handleSave(values: ReferenceItemFormValues) {
    await save.mutateAsync({
      id: editingItem?.id,
      setId: currentSet.id,
      code: editingItem?.code ?? uniqueCode(values.name, items.map((item) => item.code)),
      name: values.name,
      description: values.description,
      parentId: currentSet.parentSetId ? values.parentId || null : null,
    })
    toast.success('Запись сохранена')
    setEditingItem(null)
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }

    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Запись удалена')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleToggleActive() {
    if (!statusTarget) {
      return
    }

    try {
      await setActive.mutateAsync({ itemId: statusTarget.id, isActive: nextActive })
      toast.success(nextActive ? 'Запись включена' : 'Запись скрыта')
      setStatusTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function persistOrder(nextItems: ReferenceItem[]) {
    try {
      await reorder.mutateAsync(nextItems.map((item) => item.id))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  function openCreate() {
    setEditingItem(null)
    setEditorOpen(true)
  }

  function openEdit(item: ReferenceItem) {
    setEditingItem(item)
    setEditorOpen(true)
  }

  const usageCount = usageQuery.data ?? 0
  const showReorder = canUpdate && status === 'all' && search.trim() === ''

  return (
    <div className="space-y-4">
      <PageHeader
        title={set.name}
        description={set.description ?? 'Значения этого справочника.'}
        actions={
          canUpdate ? (
            <Button type="button" onClick={openCreate}>
              Добавить
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} label="Поиск по справочнику" placeholder="Название" />
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger aria-label="Фильтр по статусу">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="inactive">Скрытые</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {visibleItems.length === 0 ? (
        <EmptyState
          title="Записи не найдены"
          description="Измените фильтр или добавьте первое значение."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {showReorder ? <TableHead className="w-10" /> : null}
              <TableHead>Название</TableHead>
              {set.parentSetName ? <TableHead>{set.parentSetName}</TableHead> : null}
              <TableHead>Статус</TableHead>
              {canUpdate ? <TableHead className="w-[1%] whitespace-nowrap">Действия</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.map((item, index) => (
              <TableRow
                key={item.id}
                draggable={showReorder}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex === null) {
                    return
                  }
                  void persistOrder(moveIndex(items, dragIndex, index))
                  setDragIndex(null)
                }}
              >
                {showReorder ? (
                  <TableCell className="text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <GripVertical className="size-4 cursor-grab" aria-hidden="true" />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Выше"
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => void persistOrder(moveIndex(items, index, index - 1))}
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Ниже"
                        disabled={index === visibleItems.length - 1 || reorder.isPending}
                        onClick={() => void persistOrder(moveIndex(items, index, index + 1))}
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                    </span>
                  </TableCell>
                ) : null}
                <TableCell className="font-medium">{item.name}</TableCell>
                {set.parentSetName ? <TableCell>{item.parentName || '—'}</TableCell> : null}
                <TableCell>
                  <StatusBadge tone={item.isActive ? 'success' : 'neutral'}>
                    {item.isActive ? 'Активна' : 'Скрыта'}
                  </StatusBadge>
                </TableCell>
                {canUpdate ? (
                  <TableCell>
                    <div className="flex gap-1">
                      <IconActionButton label="Изменить" onClick={() => openEdit(item)}>
                        <Pencil />
                      </IconActionButton>
                      <IconActionButton
                        label={item.isActive ? 'Скрыть' : 'Включить'}
                        onClick={() => setStatusTarget(item)}
                      >
                        {item.isActive ? <EyeOff /> : <Eye />}
                      </IconActionButton>
                      <IconActionButton
                        label="Удалить"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(item)}
                      >
                        <Trash2 />
                      </IconActionButton>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ReferenceItemDialog
        open={editorOpen}
        setName={set.name}
        requiresParent={Boolean(set.parentSetId)}
        parentLabel={set.parentSetName}
        parentOptions={parentOptions}
        item={editingItem}
        isPending={save.isPending}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) {
            setEditingItem(null)
          }
        }}
        onSubmit={handleSave}
      />

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={nextActive ? 'Включить запись' : 'Скрыть запись'}
        description={
          statusTarget
            ? nextActive
              ? `${statusTarget.name} снова появится в списках.`
              : usageCount > 0
                ? `${statusTarget.name} используется в ${usageCount} связанных записях. Значение будет скрыто в новых формах, уже выбранные данные сохранятся.`
                : `${statusTarget.name} будет скрыта в списках. Удаление не выполняется.`
            : ''
        }
        confirmLabel={nextActive ? 'Включить' : 'Скрыть'}
        confirmVariant={nextActive ? 'default' : 'destructive'}
        isPending={setActive.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setStatusTarget(null)
          }
        }}
        onConfirm={() => void handleToggleActive()}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить запись"
        description={
          deleteTarget
            ? usageCount > 0
              ? `${deleteTarget.name} используется в ${usageCount} связанных записях и не будет удалена. Скройте её, чтобы не показывать в списках.`
              : `${deleteTarget.name} будет удалена безвозвратно.`
            : ''
        }
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}
