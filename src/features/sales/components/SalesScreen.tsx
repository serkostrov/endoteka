import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { formatMoney } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import {
  SALES_PAGE_SIZE,
  SALES_SEARCH_DEBOUNCE_MS,
  SaleStatus,
  saleStatusLabels,
  saleStatusTone,
} from '@/lib/constants/sales'
import { getErrorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/utils/date'

import { useCreateSale, useDeleteSale, useSales } from '../hooks/use-sales'
import type { SaleListItem } from '../services/sales-service'

export function SalesScreen() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const canCreate = useHasPermission(Permission.SalesCreate)
  const canDelete = useHasPermission(Permission.SalesDelete)
  const [deleteTarget, setDeleteTarget] = useState<SaleListItem | null>(null)
  const debouncedSearch = useDebouncedValue(search, SALES_SEARCH_DEBOUNCE_MS)
  const salesQuery = useSales(debouncedSearch, status, page, SALES_PAGE_SIZE)
  const create = useCreateSale()
  const remove = useDeleteSale()
  const navigate = useNavigate()
  const total = salesQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / SALES_PAGE_SIZE))

  async function handleCreate() {
    try {
      const id = await create.mutateAsync()
      toast.success('Счёт создан')
      navigate(routes.sale.replace(':id', id))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Счёт удалён')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Продажи"
        description="Счета внешним клиентам. Остаток списывается только после подтверждения: сначала самые ранние поступления."
      />

      <FilterBar
        end={
          canCreate ? (
            <Button type="button" disabled={create.isPending} onClick={() => void handleCreate()}>
              {create.isPending ? 'Создание…' : 'Новая продажа'}
            </Button>
          ) : null
        }
      >
        <SearchInput
          value={search}
          onChange={(next) => {
            setSearch(next)
            setPage(1)
          }}
          label="Поиск продаж"
          placeholder="Номер счёта или покупатель"
        />
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
            {Object.values(SaleStatus).map((code) => (
              <SelectItem key={code} value={code}>
                {saleStatusLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        caption="Продажи"
        isLoading={salesQuery.isLoading}
        error={salesQuery.error ? getErrorMessage(salesQuery.error) : null}
        data={salesQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Продаж нет"
        emptyDescription="Создайте счёт, укажите покупателя и подтвердите списание."
        onRowClick={(row) => navigate(routes.sale.replace(':id', row.id))}
        pagination={{ page, pageCount, onPageChange: setPage }}
        columns={[
          { id: 'invoice', header: 'Счёт', cell: (row) => row.invoiceNumber },
          { id: 'customer', header: 'Покупатель', cell: (row) => row.customerName || '—' },
          { id: 'date', header: 'Дата', cell: (row) => formatDate(row.saleDate) },
          { id: 'total', header: 'Сумма', cell: (row) => formatMoney(row.total) },
          {
            id: 'status',
            header: 'Статус',
            cell: (row) => (
              <StatusBadge tone={saleStatusTone(row.status)}>{saleStatusLabels[row.status]}</StatusBadge>
            ),
          },
          {
            id: 'actor',
            header: 'Оформил',
            className: 'hidden md:table-cell',
            cell: (row) => row.createdByName || '—',
          },
          ...(canDelete
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: SaleListItem) => (
                    <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                      <IconActionButton
                        label={
                          row.status === SaleStatus.Confirmed
                            ? 'Подтверждённую продажу нельзя удалить'
                            : 'Удалить'
                        }
                        disabled={row.status === SaleStatus.Confirmed}
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

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить счёт"
        description={
          deleteTarget ? `${deleteTarget.invoiceNumber} будет удалён без возможности восстановления.` : ''
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
