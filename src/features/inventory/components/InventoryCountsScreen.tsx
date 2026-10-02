import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SelectionBulkBar } from '@/components/shared/SelectionBulkBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import {
  InventoryCountSeedMode,
  InventoryCountStatus,
  inventoryCountStatusLabels,
  inventoryCountStatusTone,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { usePageSize } from '@/hooks/use-page-size'
import { formatDateTime } from '@/lib/utils/date'
import { formatInteger } from '@/lib/utils/number'

import { useCreateInventoryCount, useDeleteInventoryCount, useInventoryCounts } from '../hooks/use-inventory'
import type { InventoryCountListItem } from '../services/counts-service'
import { InventoryCountSheet } from './InventoryCountScreen'

export function InventoryCountsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [status, setStatus] = useState('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<InventoryCountListItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkPending, setBulkPending] = useState(false)
  const canCount = useHasPermission(Permission.InventoryCount)
  const countsQuery = useInventoryCounts(status, page, pageSize)
  const remove = useDeleteInventoryCount()
  const countId = searchParams.get('count')
  const items = countsQuery.data?.items ?? []
  const total = countsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const deletableSelected = useMemo(
    () =>
      items.filter(
        (row) => selectedIds.includes(row.id) && row.status !== InventoryCountStatus.Completed,
      ),
    [items, selectedIds],
  )

  function openCount(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('count', id)
    setSearchParams(next, { replace: true })
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
    setSelectedIds([])
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Документ удалён')
      setSelectedIds((ids) => ids.filter((id) => id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleBulkDelete() {
    if (deletableSelected.length === 0) {
      return
    }
    setBulkPending(true)
    try {
      for (const row of deletableSelected) {
        await remove.mutateAsync(row.id)
      }
      toast.success(
        deletableSelected.length === 1
          ? 'Документ удалён'
          : `Удалено документов: ${formatInteger(deletableSelected.length)}`,
      )
      setBulkDeleteOpen(false)
      setSelectedIds([])
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBulkPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Инвентаризация"
        description="Пересчёт фактических остатков и фиксация расхождений."
      />

      <FilterBar
        end={
          canCount ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый пересчёт
            </Button>
          ) : null
        }
      >
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
            setSelectedIds([])
          }}
        >
          <SelectTrigger aria-label="Фильтр по статусу">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent searchable>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.values(InventoryCountStatus).map((code) => (
              <SelectItem key={code} value={code}>
                {inventoryCountStatusLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {selectedIds.length > 0 ? (
        <SelectionBulkBar
          count={selectedIds.length}
          onClear={() => setSelectedIds([])}
          pending={bulkPending}
        >
          {canCount && deletableSelected.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              aria-label="Удалить"
              disabled={bulkPending}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </SelectionBulkBar>
      ) : null}

      <DataTable
        caption="Документы инвентаризации"
        isLoading={countsQuery.isLoading}
        error={countsQuery.error ? getErrorMessage(countsQuery.error) : null}
        data={items}
        getRowId={(row) => row.id}
        emptyTitle="Документов нет"
        emptyDescription="Создайте пересчёт и заполните факт сканером или вручную."
        onRowClick={(row) => openCount(row.id)}
        selection={{
          selectedIds,
          onSelectedIdsChange: setSelectedIds,
        }}
        pagination={{
          page,
          pageCount,
          onPageChange: (next) => {
            setPage(next)
            setSelectedIds([])
          },
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
        columns={[
          { id: 'number', header: 'Номер', className: 'min-w-[8rem]', cell: (row) => row.number },
          {
            id: 'status',
            header: 'Статус',
            className: 'w-[1%]',
            cell: (row) => (
              <StatusBadge tone={inventoryCountStatusTone(row.status)}>
                {inventoryCountStatusLabels[row.status]}
              </StatusBadge>
            ),
          },
          {
            id: 'progress',
            header: 'Прогресс',
            className: 'w-[1%]',
            cell: (row) => `${row.countedCount} / ${row.lineCount}`,
          },
          {
            id: 'diff',
            header: 'Расхождения',
            className: 'w-[1%]',
            cell: (row) => (row.discrepancyCount > 0 ? String(row.discrepancyCount) : '—'),
          },
          { id: 'actor', header: 'Ответственный', className: 'w-[1%]', cell: (row) => row.actorName || '—' },
          {
            id: 'created',
            header: 'Создан',
            className: 'hidden w-[1%] whitespace-nowrap md:table-cell',
            cell: (row) => formatDateTime(row.createdAt),
          },
          ...(canCount
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: InventoryCountListItem) => (
                    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                      <IconActionButton
                        label={
                          row.status === InventoryCountStatus.Completed
                            ? 'Проведённую инвентаризацию нельзя удалить'
                            : 'Удалить'
                        }
                        disabled={row.status === InventoryCountStatus.Completed}
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(row)}
                      >
                        <Trash2 />
                      </IconActionButton>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />

      <CreateCountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={openCount}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить инвентаризацию"
        description={
          deleteTarget
            ? `${deleteTarget.number} будет удалена без возможности восстановления.`
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
      <ConfirmDialog
        open={bulkDeleteOpen}
        title="Удалить инвентаризации"
        description={
          deletableSelected.length === 1
            ? `${deletableSelected[0]?.number} будет удалена без возможности восстановления.`
            : `Будет удалено документов: ${formatInteger(deletableSelected.length)}. Проведённые не удаляются.`
        }
        confirmLabel="Удалить"
        isPending={bulkPending || remove.isPending}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={() => void handleBulkDelete()}
      />
      <InventoryCountSheet
        countId={countId}
        open={Boolean(countId)}
        onOpenChange={(open) => {
          if (!open) {
            const next = new URLSearchParams(searchParams)
            next.delete('count')
            setSearchParams(next, { replace: true })
          }
        }}
      />
    </div>
  )
}

function CreateCountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const create = useCreateInventoryCount()
  const [seedMode, setSeedMode] = useState<InventoryCountSeedMode>(InventoryCountSeedMode.InStock)

  async function submit() {
    try {
      const id = await create.mutateAsync({ seedMode })
      toast.success('Документ создан')
      onOpenChange(false)
      onCreated(id)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая инвентаризация</DialogTitle>
          <DialogDescription>
            Ожидаемое количество фиксируется на момент добавления строки. Проведение создаёт движения журнала.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm font-medium">Заполнение</p>
          <Select value={seedMode} onValueChange={(value) => setSeedMode(value as InventoryCountSeedMode)}>
            <SelectTrigger aria-label="Способ заполнения">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={InventoryCountSeedMode.InStock}>Позиции с остатком</SelectItem>
              <SelectItem value={InventoryCountSeedMode.Empty}>Пустой документ</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" disabled={create.isPending} onClick={() => void submit()}>
            {create.isPending ? 'Создание…' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
