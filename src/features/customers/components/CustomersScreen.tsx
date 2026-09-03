import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageTabs } from '@/components/shared/PageTabs'
import { SearchInput } from '@/components/shared/SearchInput'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { CUSTOMER_SEARCH_DEBOUNCE_MS, CustomerKind } from '@/lib/constants/customers'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'

import { CreateCustomerDialog } from './CreateCustomerDialog'
import { EditCustomerDialog } from './EditCustomerDialog'
import { useCustomers, useDeleteCustomer } from '../hooks/use-customers'
import type { Customer } from '../services/customers-service'

type ContactsTab = 'people' | 'organizations'

const tabItems = [
  { id: 'people' as const, label: 'Люди' },
  { id: 'organizations' as const, label: 'Организации' },
]

function parseTab(value: string | null): ContactsTab {
  return value === 'organizations' ? 'organizations' : 'people'
}

export function CustomersScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Customer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)
  const canCreate = useHasPermission(Permission.CustomersCreate)
  const canUpdate = useHasPermission(Permission.CustomersUpdate)
  const canDelete = useHasPermission(Permission.CustomersDelete)
  const tab = parseTab(searchParams.get('tab'))
  const isPeople = tab === 'people'
  const kind = isPeople ? CustomerKind.Individual : CustomerKind.Organization
  const debouncedSearch = useDebouncedValue(search, CUSTOMER_SEARCH_DEBOUNCE_MS)
  const customersQuery = useCustomers(debouncedSearch, page, pageSize, kind)
  const remove = useDeleteCustomer()
  const navigate = useNavigate()
  const total = customersQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
  }

  function setTab(next: ContactsTab) {
    const params = new URLSearchParams(searchParams)
    if (next === 'people') {
      params.delete('tab')
    } else {
      params.set('tab', next)
    }
    setSearchParams(params, { replace: true })
    setPage(1)
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success(isPeople ? 'Контакт удалён' : 'Организация удалена')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const columns: DataTableColumn<Customer>[] = [
    {
      id: 'name',
      header: isPeople ? 'ФИО' : 'Название',
      cell: (row) => (
        <div className="min-w-0">
          <div className="font-medium">{row.name}</div>
          {row.contactName ? <div className="text-xs text-muted-foreground">{row.contactName}</div> : null}
        </div>
      ),
    },
    ...(isPeople
      ? []
      : [{ id: 'inn', header: 'ИНН', cell: (row: Customer) => row.inn || '—' }]),
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
          } satisfies DataTableColumn<Customer>,
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <div>
        <PageHeader
          className="mb-3"
          title="Контакты"
          description="Люди и организации. Поиск по имени, телефону, email и реквизитам."
        />
        <PageTabs aria-label="Тип контактов" value={tab} onChange={setTab} items={tabItems} />
      </div>

      <FilterBar
        end={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus />
              {isPeople ? 'Новый человек' : 'Новая организация'}
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
          className="max-w-xl"
          label={isPeople ? 'Поиск людей' : 'Поиск организаций'}
          placeholder={
            isPeople
              ? 'ФИО, телефон, email, город'
              : 'Название, ИНН, телефон, email, город'
          }
        />
      </FilterBar>

      <DataTable
        caption="Контакты"
        isLoading={customersQuery.isLoading}
        error={customersQuery.error ? getErrorMessage(customersQuery.error) : null}
        data={customersQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle={isPeople ? 'Люди не найдены' : 'Организации не найдены'}
        emptyDescription={
          search.trim()
            ? 'Измените запрос или добавьте контакт.'
            : isPeople
              ? 'Добавьте первого человека в справочник.'
              : 'Добавьте первую организацию в справочник.'
        }
        onRowClick={(row) => navigate(routes.customer.replace(':id', row.id))}
        pagination={{
          page,
          pageCount,
          onPageChange: setPage,
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
        columns={columns}
      />

      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultKind={kind}
        hideKind
        title={isPeople ? 'Новый человек' : 'Новая организация'}
        description={
          isPeople
            ? 'ФИО и контакты. Запись сохранится в справочнике.'
            : 'Реквизиты и контакты организации.'
        }
      />
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
        title={isPeople ? 'Удалить контакт' : 'Удалить организацию'}
        description={
          deleteTarget
            ? isPeople
              ? `${deleteTarget.name} будет удалён. Если есть заказы или продажи, удаление не пройдёт.`
              : `${deleteTarget.name} будет удалена. Если есть заказы или продажи, удаление не пройдёт.`
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
