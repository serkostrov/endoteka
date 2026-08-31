import { type KeyboardEvent, useState } from 'react'

import { SearchInput } from '@/components/shared/SearchInput'
import { SearchEmptyCreate, SearchSuggestOverlay } from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { CUSTOMER_PICKER_PAGE_SIZE, CUSTOMER_SEARCH_DEBOUNCE_MS } from '@/lib/constants/customers'
import { Permission } from '@/lib/constants/permissions'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

import { CreateCustomerDialog } from './CreateCustomerDialog'
import { EditCustomerDialog } from './EditCustomerDialog'
import { customerKindLabel } from '../schemas'
import { useCustomerCard, useCustomerSearch } from '../hooks/use-customers'
import type { Customer } from '../services/customers-service'

type CustomerPickerProps = {
  value: string
  onChange: (customer: Customer | null) => void
  disabled?: boolean
  framed?: boolean
  compact?: boolean
  label?: string
  searchLabel?: string
  placeholder?: string
  emptyMessage?: string
  createTitle?: string
  createDescription?: string
}

export function CustomerPicker({
  value,
  onChange,
  disabled = false,
  framed = false,
  compact = false,
  label,
  searchLabel = 'Поиск клиента',
  placeholder = 'Имя, телефон или ИНН',
  emptyMessage = 'Клиенты не найдены',
  createTitle,
  createDescription,
}: CustomerPickerProps) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
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

  const body = selected ? (
    <CustomerLookupCard
      customer={selected}
      compact={compact}
      disabled={disabled}
      onClear={() => {
        setEditOpen(false)
        onChange(null)
      }}
      onOpen={() => setEditOpen(true)}
    />
  ) : (
    <SearchSuggestOverlay
      open={open}
      onOpenChange={setOpen}
      panel={
        <>
          <div className="max-h-64 overflow-auto">
            {searching && items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">Поиск…</p>
            ) : items.length === 0 ? (
              <SearchEmptyCreate
                message={emptyMessage}
                actionLabel="Новый"
                disabled={disabled}
                onCreate={
                  canCreate
                    ? () => {
                        setOpen(false)
                        setCreateOpen(true)
                      }
                    : undefined
                }
              />
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
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        label={searchLabel}
        placeholder={placeholder}
        className="max-w-none"
      />
    </SearchSuggestOverlay>
  )

  return (
    <div className={cn('min-w-0', !compact && 'flex h-full min-h-0 flex-col')}>
      {framed ? (
        <section className="rounded-xl border bg-card p-4">
          {label ? (
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          ) : null}
          {body}
        </section>
      ) : (
        body
      )}

      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={createTitle}
        description={createDescription}
        onCreated={(customer) => {
          selectCustomer(customer)
        }}
      />
      <EditCustomerDialog customer={selected} open={editOpen && Boolean(selected)} onOpenChange={setEditOpen} />
    </div>
  )
}

function CustomerLookupCard({
  customer,
  compact = false,
  disabled,
  onClear,
  onOpen,
}: {
  customer: Customer
  compact?: boolean
  disabled?: boolean
  onClear: () => void
  onOpen: () => void
}) {
  const clickable = !disabled
  const facts = [
    ['ИНН', customer.inn],
    ['Телефон', customer.phone],
    ['Email', customer.email],
    ['Город', customer.city],
    ['Контакт', customer.contactName],
    ['КПП', customer.kpp],
    ['ОГРН', customer.ogrn],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
  const compactMeta = [customerKindLabel(customer.kind), customer.inn, customer.phone].filter(Boolean).join(' · ')

  function onCardKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!clickable) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }

  if (compact) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 shadow-xs">
        <div
          className={cn('min-w-0 flex-1 truncate text-left text-sm', clickable && 'cursor-pointer')}
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          aria-label={clickable ? `Открыть контакт ${customer.name}` : undefined}
          onClick={clickable ? onOpen : undefined}
          onKeyDown={onCardKeyDown}
        >
          <span className="font-medium">{customer.name}</span>
          {compactMeta ? <span className="text-muted-foreground"> · {compactMeta}</span> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" className="-mr-2 h-7 px-2" disabled={disabled} onClick={onClear}>
          Сменить
        </Button>
      </div>
    )
  }

  return (
    <div
      className={cn('space-y-3 text-left', clickable && 'cursor-pointer rounded-md transition-colors hover:bg-muted/40')}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Открыть клиента ${customer.name}` : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={onCardKeyDown}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{customer.name}</p>
          <p className="truncate text-xs text-muted-foreground">{customerKindLabel(customer.kind)}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onClear()
          }}
        >
          Сменить
        </Button>
      </div>

      {facts.length > 0 ? (
        <dl className="space-y-1.5">
          {facts.map(([name, value]) => (
            <div key={name} className="space-y-0.5 text-sm">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
