import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageTabs } from '@/components/shared/PageTabs'
import { SearchInput } from '@/components/shared/SearchInput'
import { SelectionBulkBar } from '@/components/shared/SelectionBulkBar'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import {
  CUSTOMER_SEARCH_DEBOUNCE_MS,
  CustomerKind,
  customerKindLabels,
} from '@/lib/constants/customers'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'
import { formatInteger } from '@/lib/utils/number'

import { CreateCustomerDialog } from './CreateCustomerDialog'
import { CustomerDetailSheet } from './CustomerDetailScreen'
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
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkPending, setBulkPending] = useState(false)
  const canCreate = useHasPermission(Permission.CustomersCreate)
  const canDelete = useHasPermission(Permission.CustomersDelete)
  const tab = parseTab(searchParams.get('tab'))
  const isPeople = tab === 'people'
  const kind = isPeople ? CustomerKind.Individual : CustomerKind.Organization
  const debouncedSearch = useDebouncedValue(search, CUSTOMER_SEARCH_DEBOUNCE_MS)
  const hasSearch = debouncedSearch.trim().length > 0
  // Поиск ищет по всем контактам: вкладка — только фильтр просмотра без запроса.
  const customersQuery = useCustomers(
    debouncedSearch,
    page,
    pageSize,
    hasSearch ? undefined : kind,
  )
  const remove = useDeleteCustomer()
  const customerId = searchParams.get('customer')
  const total = customersQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
    setSelectedIds([])
  }

  function openCustomer(id: string) {
    const params = new URLSearchParams(searchParams)
    params.set('customer', id)
    params.delete('edit')
    setSearchParams(params, { replace: true })
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
    setSelectedIds([])
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success(isPeople ? 'Контакт удалён' : 'Организация удалена')
      setSelectedIds((ids) => ids.filter((id) => id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.length === 0) {
      return
    }
    setBulkPending(true)
    try {
      for (const id of selectedIds) {
        await remove.mutateAsync(id)
      }
      toast.success(
        selectedIds.length === 1
          ? isPeople
            ? 'Контакт удалён'
            : 'Организация удалена'
          : isPeople
            ? `Удалено контактов: ${formatInteger(selectedIds.length)}`
            : `Удалено организаций: ${formatInteger(selectedIds.length)}`,
      )
      setBulkDeleteOpen(false)
      setSelectedIds([])
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBulkPending(false)
    }
  }

  const columns: DataTableColumn<Customer>[] = [
    {
      id: 'name',
      header: hasSearch ? 'Контакт' : isPeople ? 'ФИО' : 'Название',
      cell: (row) => {
        const subtitle = [
          hasSearch ? customerKindLabels[row.kind] : null,
          row.contactName || null,
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <div className="min-w-0">
            <div className="font-medium">{row.name}</div>
            {subtitle ? <div className="text-xs text-muted-foreground">{subtitle}</div> : null}
          </div>
        )
      },
    },
    ...(hasSearch || !isPeople
      ? [{ id: 'inn', header: 'ИНН', cell: (row: Customer) => row.inn || '—' }]
      : []),
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
    ...(canDelete
      ? [
          {
            id: 'actions',
            header: 'Действия',
            className: 'w-[1%] whitespace-nowrap',
            cell: (row: Customer) => (
              <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                <IconActionButton
                  label="Удалить"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(row)}
                >
                  <Trash2 />
                </IconActionButton>
              </div>
            ),
          } satisfies DataTableColumn<Customer>,
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <PageHeader
          title="Контакты"
          description="Карточки клиентов и организаций для заказов и продаж."
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
            setSelectedIds([])
          }}
          className="max-w-xl"
          label="Поиск контактов"
          placeholder="ФИО, название, ИНН, телефон, email, город"
        />
      </FilterBar>

      {selectedIds.length > 0 ? (
        <SelectionBulkBar
          count={selectedIds.length}
          onClear={() => setSelectedIds([])}
          pending={bulkPending}
        >
          {canDelete ? (
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
        caption="Контакты"
        isLoading={customersQuery.isLoading}
        error={customersQuery.error ? getErrorMessage(customersQuery.error) : null}
        data={customersQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle={
          search.trim()
            ? 'Контакты не найдены'
            : isPeople
              ? 'Люди не найдены'
              : 'Организации не найдены'
        }
        emptyDescription={
          search.trim()
            ? 'Измените запрос или добавьте контакт.'
            : isPeople
              ? 'Добавьте первого человека в справочник.'
              : 'Добавьте первую организацию в справочник.'
        }
        onRowClick={(row) => openCustomer(row.id)}
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
      <ConfirmDialog
        open={bulkDeleteOpen}
        title={isPeople ? 'Удалить контакты' : 'Удалить организации'}
        description={
          selectedIds.length === 1
            ? isPeople
              ? 'Выбранный контакт будет удалён. Если есть заказы или продажи, удаление не пройдёт.'
              : 'Выбранная организация будет удалена. Если есть заказы или продажи, удаление не пройдёт.'
            : isPeople
              ? `Будет удалено контактов: ${formatInteger(selectedIds.length)}. Записи с заказами или продажами не удалятся.`
              : `Будет удалено организаций: ${formatInteger(selectedIds.length)}. Записи с заказами или продажами не удалятся.`
        }
        confirmLabel="Удалить"
        isPending={bulkPending || remove.isPending}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={() => void handleBulkDelete()}
      />
      <CustomerDetailSheet
        customerId={customerId}
        open={Boolean(customerId)}
        onOpenChange={(open) => {
          if (!open) {
            const params = new URLSearchParams(searchParams)
            params.delete('customer')
            params.delete('edit')
            setSearchParams(params, { replace: true })
          }
        }}
      />
    </div>
  )
}
