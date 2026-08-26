import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
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
import { useHasPermission } from '@/features/auth'
import { CUSTOMER_PAGE_SIZE, CUSTOMER_SEARCH_DEBOUNCE_MS } from '@/lib/constants/customers'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { CreateCustomerDialog } from './CreateCustomerDialog'
import { EditCustomerDialog } from './EditCustomerDialog'
import { customerKindLabel } from '../schemas'
import { useCustomers, useDeleteCustomer } from '../hooks/use-customers'
import type { Customer } from '../services/customers-service'

export function CustomersScreen() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Customer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)
  const canCreate = useHasPermission(Permission.CustomersCreate)
  const canUpdate = useHasPermission(Permission.CustomersUpdate)
  const canDelete = useHasPermission(Permission.CustomersDelete)
  const debouncedSearch = useDebouncedValue(search, CUSTOMER_SEARCH_DEBOUNCE_MS)
  const customersQuery = useCustomers(debouncedSearch, page, CUSTOMER_PAGE_SIZE)
  const remove = useDeleteCustomer()
  const navigate = useNavigate()
  const total = customersQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE))

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Клиент удалён')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Клиенты"
        description="Организации и физлица. Поиск по названию, ФИО, телефону, email и реквизитам."
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый клиент
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={(next) => {
            setSearch(next)
            setPage(1)
          }}
          label="Поиск клиентов"
          placeholder="Название, ФИО, телефон, email, ИНН, КПП, ОГРН"
        />
      </FilterBar>

      <DataTable
        caption="Клиенты"
        isLoading={customersQuery.isLoading}
        error={customersQuery.error ? getErrorMessage(customersQuery.error) : null}
        data={customersQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Клиенты не найдены"
        emptyDescription="Измените запрос или добавьте клиента."
        onRowClick={(row) => navigate(routes.customer.replace(':id', row.id))}
        pagination={{
          page,
          pageCount,
          onPageChange: setPage,
        }}
        columns={[
          { id: 'name', header: 'Клиент', cell: (row) => row.name },
          {
            id: 'kind',
            header: 'Тип',
            cell: (row) => <StatusBadge tone="neutral">{customerKindLabel(row.kind)}</StatusBadge>,
          },
          { id: 'inn', header: 'ИНН', cell: (row) => row.inn || '—' },
          {
            id: 'phone',
            header: 'Телефон',
            cell: (row) => row.phone || '—',
          },
          {
            id: 'email',
            header: 'Email',
            className: 'hidden md:table-cell',
            cell: (row) => row.email || '—',
          },
          {
            id: 'city',
            header: 'Город',
            className: 'hidden lg:table-cell',
            cell: (row) => row.city || '—',
          },
          ...(canUpdate || canDelete
            ? [
                {
                  id: 'actions',
                  header: 'Действия',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: Customer) => (
                    <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                      {canUpdate ? (
                        <IconActionButton label="Изменить" onClick={() => setEditTarget(row)}>
                          <Pencil />
                        </IconActionButton>
                      ) : null}
                      {canDelete ? (
                        <IconActionButton
                          label="Удалить"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 />
                        </IconActionButton>
                      ) : null}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />

      <CreateCustomerDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditCustomerDialog
        customer={editTarget}
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null)
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить клиента"
        description={
          deleteTarget
            ? `${deleteTarget.name} будет удалён. Если по нему есть заказы или продажи, удаление не пройдёт.`
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
