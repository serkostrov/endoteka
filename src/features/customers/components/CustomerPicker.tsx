import { type KeyboardEvent, useState } from 'react'

import { SearchInput } from '@/components/shared/SearchInput'
import {
  SearchCreateAction,
  SearchEmptyCreate,
  SearchSuggestOverlay,
} from '@/components/shared/SearchSuggestOverlay'
import { Button } from '@/components/ui/button'
import { CUSTOMER_PICKER_PAGE_SIZE, CUSTOMER_SEARCH_DEBOUNCE_MS } from '@/lib/constants/customers'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

import { CreateCustomerDialog } from './CreateCustomerDialog'
import { CustomerDetailSheet } from './CustomerDetailScreen'
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
  const [detailOpen, setDetailOpen] = useState(false)
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

  function clearCustomer() {
    onChange(null)
    setDetailOpen(false)
  }

  const body = selected ? (
    <CustomerLookupCard
      customer={selected}
      compact={compact}
      disabled={disabled}
      onOpen={() => setDetailOpen(true)}
      onClear={framed ? undefined : clearCustomer}
    />
  ) : (
    <SearchSuggestOverlay
      open={open}
      onOpenChange={setOpen}
      panel={
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 max-h-64 overflow-auto">
            {searching && items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">Поиск…</p>
            ) : items.length === 0 ? (
              <SearchEmptyCreate
                message={emptyMessage}
                actionLabel="Новый"
                disabled={disabled}
                actionSize="comfortable"
                onCreate={() => {
                  setOpen(false)
                  setCreateOpen(true)
                }}
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
                        {customerKindLabel(customer.kind)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {pageCount > 1 && items.length > 0 ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2 text-sm">
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
          {items.length > 0 ? (
            <SearchCreateAction
              label="Новый"
              disabled={disabled}
              size="comfortable"
              onCreate={() => {
                setOpen(false)
                setCreateOpen(true)
              }}
            />
          ) : null}
        </div>
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
        <section className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border bg-background p-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            {label ? (
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
            ) : (
              <span />
            )}
            {selected && !disabled ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto shrink-0 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearCustomer}
              >
                Сменить
              </Button>
            ) : null}
          </div>
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
      <CustomerDetailSheet
        customerId={selected?.id ?? null}
        open={detailOpen && Boolean(selected)}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

function CustomerLookupCard({
  customer,
  compact = false,
  disabled,
  onOpen,
  onClear,
}: {
  customer: Customer
  compact?: boolean
  disabled?: boolean
  onOpen: () => void
  onClear?: () => void
}) {
  const action = onClear ?? onOpen
  const clickable = !disabled
  const compactMeta = [customerKindLabel(customer.kind), customer.phone].filter(Boolean).join(' · ')
  const ariaLabel = onClear ? `Сменить клиента ${customer.name}` : `Открыть карточку ${customer.name}`

  function onCardKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!clickable) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }

  if (compact) {
    return (
      <div
        className={cn(
          'flex h-9 items-center rounded-md border bg-background px-3 shadow-xs',
          clickable && 'cursor-pointer transition-colors hover:bg-muted/40',
        )}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-label={clickable ? ariaLabel : undefined}
        onClick={clickable ? action : undefined}
        onKeyDown={onCardKeyDown}
      >
        <div className="min-w-0 flex-1 truncate text-left text-sm">
          <span className="font-medium">{customer.name}</span>
          {compactMeta ? <span className="text-muted-foreground"> · {compactMeta}</span> : null}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'text-left',
        clickable && 'cursor-pointer rounded-md transition-colors hover:bg-muted/50',
      )}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? ariaLabel : undefined}
      onClick={clickable ? action : undefined}
      onKeyDown={onCardKeyDown}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{customer.name}</p>
        <p className="truncate text-xs text-muted-foreground">{customerKindLabel(customer.kind)}</p>
      </div>
    </div>
  )
}
