import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { PageHeader } from '@/components/shared/PageHeader'
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
  INVENTORY_PAGE_SIZE,
  InventoryCountSeedMode,
  InventoryCountStatus,
  inventoryCountStatusLabels,
  inventoryCountStatusTone,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { useCreateInventoryCount, useInventoryCounts } from '../hooks/use-inventory'

export function InventoryCountsScreen() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [createOpen, setCreateOpen] = useState(false)
  const canCount = useHasPermission(Permission.InventoryCount)
  const countsQuery = useInventoryCounts(status, page, INVENTORY_PAGE_SIZE)
  const navigate = useNavigate()
  const total = countsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Инвентаризация"
        description="Документ пересчёта. Расхождения проводятся журналом движений, остаток вручную не перезаписывается."
        actions={
          canCount ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый пересчёт
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Фильтр по статусу">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.values(InventoryCountStatus).map((code) => (
              <SelectItem key={code} value={code}>
                {inventoryCountStatusLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        caption="Документы инвентаризации"
        isLoading={countsQuery.isLoading}
        error={countsQuery.error ? getErrorMessage(countsQuery.error) : null}
        data={countsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Документов нет"
        emptyDescription="Создайте пересчёт и заполните факт сканером или вручную."
        onRowClick={(row) => navigate(routes.inventoryCount.replace(':id', row.id))}
        pagination={{ page, pageCount, onPageChange: setPage }}
        columns={[
          { id: 'number', header: 'Номер', cell: (row) => row.number },
          {
            id: 'status',
            header: 'Статус',
            cell: (row) => (
              <StatusBadge tone={inventoryCountStatusTone(row.status)}>
                {inventoryCountStatusLabels[row.status]}
              </StatusBadge>
            ),
          },
          {
            id: 'progress',
            header: 'Прогресс',
            cell: (row) => `${row.countedCount} / ${row.lineCount}`,
          },
          {
            id: 'diff',
            header: 'Расхождения',
            cell: (row) => (row.discrepancyCount > 0 ? String(row.discrepancyCount) : '—'),
          },
          { id: 'actor', header: 'Ответственный', cell: (row) => row.actorName || '—' },
          {
            id: 'created',
            header: 'Создан',
            className: 'hidden md:table-cell',
            cell: (row) => formatDateTime(row.createdAt),
          },
        ]}
      />

      <CreateCountDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function CreateCountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateInventoryCount()
  const navigate = useNavigate()
  const [seedMode, setSeedMode] = useState<InventoryCountSeedMode>(InventoryCountSeedMode.InStock)

  async function submit() {
    try {
      const id = await create.mutateAsync({ seedMode })
      toast.success('Документ создан')
      onOpenChange(false)
      navigate(routes.inventoryCount.replace(':id', id))
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
