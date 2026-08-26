import { Plus } from 'lucide-react'
import { useState } from 'react'

import { SearchInput } from '@/components/shared/SearchInput'
import { SearchSuggestOverlay } from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { CUSTOMER_PICKER_PAGE_SIZE, CUSTOMER_SEARCH_DEBOUNCE_MS } from '@/lib/constants/customers'
import { Permission } from '@/lib/constants/permissions'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

import { CreateCustomerDialog } from './CreateCustomerDialog'
import { customerKindLabel } from '../schemas'
import { useCustomerCard, useCustomerSearch } from '../hooks/use-customers'
import type { Customer } from '../services/customers-service'

type CustomerPickerProps = {
  value: string
  onChange: (customer: Customer | null) => void
  disabled?: boolean
}

export function CustomerPicker({ value, onChange, disabled = false }: CustomerPickerProps) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const canCreate = useHasPermission(Permission.CustomersCreate)
  const selectedQuery = useCustomerCard(value || undefined)
  const debouncedQuery = useDebouncedValue(query.trim(), CUSTOMER_SEARCH_DEBOUNCE_MS)
  const searchQuery = useCustomerSearch(debouncedQuery, page, CUSTOMER_PICKER_PAGE_SIZE, open)
  const selected = selectedQuery.data?.customer ?? null
  const items = searchQuery.data?.items ?? []
  const total = searchQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PICKER_PAGE_SIZE))
  const searching = open && (searchQuery.isFetching || query.trim() !== debouncedQuery)

  function selectCustomer(customer: Customer) {
    onChange(customer)
    setQuery('')
    setPage(1)
    setOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      {selected ? (
        <CustomerLookupCard customer={selected} disabled={disabled} onClear={() => onChange(null)} />
      ) : (
        <>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <SearchSuggestOverlay
            open={open}
            onOpenChange={setOpen}
            panel={
              <>
                <div className="max-h-64 overflow-auto">
                  {searching && items.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">Поиск…</p>
                  ) : items.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">Клиенты не найдены</p>
                  ) : (
                    <ul>
                      {items.map((customer) => (
                        <li key={customer.id}>
                          <button
                            type="button"
                            disabled={disabled}
                            className={cn(
                              'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent',
                            )}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectCustomer(customer)}
                          >
                            <span className="font-medium">{customer.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {[customerKindLabel(customer.kind), customer.inn, customer.phone, customer.email]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {pageCount > 1 && items.length > 0 ? (
                  <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm">
                    <span className="text-muted-foreground">
                      {page} из {pageCount}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                      >
                        Назад
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={page >= pageCount}
                        onClick={() => setPage((current) => current + 1)}
                      >
                        Ещё
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            }
          >
            <SearchInput
              value={query}
              disabled={disabled}
              onChange={(next) => {
                setQuery(next)
                setPage(1)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false)
                }
              }}
              label="Поиск клиента"
              placeholder="Имя, телефон или ИНН"
              className="max-w-none"
            />
              </SearchSuggestOverlay>
            </div>
            {canCreate ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0"
                disabled={disabled}
                aria-label="Новый клиент"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
                Новый
              </Button>
            ) : null}
          </div>
        </>
      )}

      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(customer) => {
          selectCustomer(customer)
        }}
      />
    </div>
  )
}

function CustomerLookupCard({
  customer,
  disabled,
  onClear,
}: {
  customer: Customer
  disabled?: boolean
  onClear: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-md border bg-card px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{customer.name}</p>
          <p className="truncate text-xs text-muted-foreground">{customerKindLabel(customer.kind)}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onClear}>
          Сменить
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <InfoField label="ИНН" value={customer.inn} />
        <InfoField label="Телефон" value={customer.phone} />
        <InfoField label="Email" value={customer.email} />
        <InfoField label="Город" value={customer.city} />
        {customer.contactName ? <InfoField label="Контакт" value={customer.contactName} /> : null}
        {customer.kpp ? <InfoField label="КПП" value={customer.kpp} /> : null}
        {customer.ogrn ? <InfoField label="ОГРН" value={customer.ogrn} /> : null}
      </div>
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm">{value.trim() || '—'}</p>
    </div>
  )
}
