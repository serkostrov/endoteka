import { Archive } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ErrorState } from '@/components/shared/ErrorState'
import { FilterBar } from '@/components/shared/FilterBar'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { SegmentedFilter } from '@/components/shared/SegmentedFilter'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth, useHasPermission } from '@/features/auth'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import {
  DeadlineState,
  deadlineStateLabels,
  ORDER_BOARD_PAGE_SIZE,
  ORDER_PAGE_SIZE,
  ORDER_SEARCH_DEBOUNCE_MS,
} from '@/lib/constants/orders'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { CreateOrderDialog } from './CreateOrderDialog'
import { OrderDetailSheet } from './OrderDetailScreen'
import { OrderKanbanBoard } from './OrderKanbanBoard'
import { OrderListTable } from './OrderListTable'
import { OrdersViewSwitcher, type OrdersViewMode } from './OrdersViewSwitcher'
import { useOrders, useOrderStatusCatalog } from '../hooks/use-orders'
import type { OrderSortColumn } from '../services/orders-service'

const LIST_SORT_COLUMNS = [
  'number',
  'deadline',
  'status',
  'responsible',
  'device',
  'malfunction',
  'client',
] as const satisfies readonly OrderSortColumn[]

const DEFAULT_LIST_SORT: OrderSortColumn = 'deadline'
const DEFAULT_LIST_DIR = 'asc' as const

function isDeadlineFilter(value: string) {
  return (
    value === 'all' ||
    value === DeadlineState.Overdue ||
    value === DeadlineState.Approaching ||
    value === DeadlineState.Normal ||
    value === DeadlineState.None
  )
}

function parsePage(value: string | null) {
  if (!value) {
    return 1
  }
  const page = Number.parseInt(value, 10)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function parseListSort(value: string | null): OrderSortColumn {
  return LIST_SORT_COLUMNS.includes(value as (typeof LIST_SORT_COLUMNS)[number])
    ? (value as OrderSortColumn)
    : DEFAULT_LIST_SORT
}

function parseListDir(value: string | null): 'asc' | 'desc' {
  return value === 'desc' || value === 'asc' ? value : DEFAULT_LIST_DIR
}

export function OrdersScreen() {
  const { user } = useAuth()
  const canCreate = useHasPermission(Permission.OrdersCreate)
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, ORDER_SEARCH_DEBOUNCE_MS)

  const view: OrdersViewMode = searchParams.get('view') === 'kanban' ? 'kanban' : 'list'
  const isList = view === 'list'
  const page = parsePage(searchParams.get('page'))
  const listSort = parseListSort(searchParams.get('sort'))
  const listDir = parseListDir(searchParams.get('dir'))
  const deadlineParam = searchParams.get('deadline') ?? 'all'
  const deadlineState = isDeadlineFilter(deadlineParam) ? deadlineParam : 'all'
  const responsibleParam = searchParams.get('responsible') ?? 'all'
  const attentionOnly = searchParams.get('attention') === '1'
  const activeOnly = searchParams.get('active') === '1' && !attentionOnly
  const statusCode = searchParams.get('status') ?? 'all'

  const employees = useActiveEmployees()
  const catalogQuery = useOrderStatusCatalog()
  const showClosed = searchParams.get('closed') === '1'
  const responsibleId = responsibleParam === 'me' ? (user?.id ?? '') : responsibleParam
  const filtersReady =
    (responsibleParam !== 'me' || Boolean(user?.id)) &&
    !(isList && statusCode !== 'all' && catalogQuery.isLoading)
  const responsibleSelectValue = responsibleParam === 'me' ? (user?.id ?? 'me') : responsibleParam
  const statusId =
    isList && statusCode !== 'all'
      ? (catalogQuery.data?.find((item) => item.code === statusCode)?.id ?? 'all')
      : 'all'

  const ordersQuery = useOrders(
    {
      search: debouncedSearch,
      statusId,
      responsibleId: responsibleId || 'all',
      deadlineState,
      activeOnly: isList ? !showClosed && !attentionOnly : activeOnly,
      attentionOnly,
      sort: isList ? listSort : 'updated',
      direction: isList ? listDir : 'desc',
      page: isList ? page : 1,
      pageSize: isList ? ORDER_PAGE_SIZE : ORDER_BOARD_PAGE_SIZE,
    },
    filtersReady,
  )

  const items = (ordersQuery.data?.items ?? []).filter(
    (order) => statusId !== 'all' || statusCode === 'all' || order.statusCode === statusCode,
  )
  const total = ordersQuery.data?.total ?? 0
  const closedStatusIds = new Set(
    (catalogQuery.data ?? [])
      .filter((item) => item.isActive && item.isTerminal)
      .map((item) => item.id),
  )
  const closedCount = items.filter((order) => order.isTerminal || closedStatusIds.has(order.statusId)).length
  const listBlockedByBoardPlaceholder =
    isList && ordersQuery.isPlaceholderData && (ordersQuery.data?.items.length ?? 0) > ORDER_PAGE_SIZE

  const createOpen = canCreate && searchParams.get('new') === '1'

  function patchFilters(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    }
    if (!('page' in patch)) {
      next.delete('page')
    }
    setSearchParams(next, { replace: true })
  }

  const assignmentFilter = responsibleParam === 'me' ? 'me' : 'all'

  function setAssignmentFilter(next: 'all' | 'me') {
    patchFilters({ responsible: next, attention: null, active: null })
  }

  function setView(next: OrdersViewMode) {
    patchFilters({ view: next === 'list' ? null : 'kanban' })
  }

  function handleListSort(column: OrderSortColumn) {
    const nextDir = listSort === column ? (listDir === 'asc' ? 'desc' : 'asc') : 'desc'
    const isDefault = column === DEFAULT_LIST_SORT && nextDir === DEFAULT_LIST_DIR
    patchFilters({
      sort: isDefault ? null : column,
      dir: isDefault ? null : nextDir,
    })
  }

  function openOrder(orderId: string) {
    const next = new URLSearchParams(searchParams)
    next.set('order', orderId)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }

  function setCreateOpen(open: boolean) {
    const next = new URLSearchParams(searchParams)
    if (open) {
      next.set('new', '1')
      next.delete('order')
    } else {
      next.delete('new')
    }
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-col gap-4">
      <PageHeader
        title="Заказы"
        titleExtra={<OrdersViewSwitcher value={view} onChange={setView} />}
        description={
          isList
            ? 'Все заказы списком. Карточка открывается справа.'
            : 'Доска ремонта по этапам. Карточка открывается справа.'
        }
      />

      <FilterBar
        end={
          <>
            <Button
              type="button"
              variant={showClosed ? 'secondary' : 'outline'}
              className="h-9"
              aria-pressed={showClosed}
              onClick={() =>
                patchFilters(showClosed ? { closed: null } : { closed: '1', active: null })
              }
            >
              <Archive className="size-4" />
              {showClosed ? 'Скрыть закрытые' : 'Закрытые'}
              {closedCount > 0 ? (
                <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                  {closedCount}
                </span>
              ) : null}
            </Button>
            {canCreate ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                Новый заказ
              </Button>
            ) : null}
          </>
        }
      >
        <SegmentedFilter
          aria-label="Назначение"
          value={assignmentFilter}
          options={[
            { value: 'all', label: 'Все заказы' },
            { value: 'me', label: 'Назначены мне' },
          ]}
          onChange={setAssignmentFilter}
        />
        <SearchInput
          value={search}
          onChange={(next) => {
            setSearch(next)
            if (searchParams.has('page')) {
              patchFilters({ page: null })
            }
          }}
          label="Поиск заказов"
          placeholder="Номер, клиент или серийный номер"
        />
        <Select
          value={responsibleSelectValue}
          onValueChange={(value) => {
            const next = value === user?.id ? 'me' : value
            patchFilters({ responsible: next, attention: null, active: null })
          }}
        >
          <SelectTrigger aria-label="Фильтр по ответственному">
            <SelectValue placeholder="Ответственный" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все ответственные</SelectItem>
            <SelectItem value="unassigned">Без ответственного</SelectItem>
            {(employees.data ?? []).map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={deadlineState} onValueChange={(value) => patchFilters({ deadline: value, attention: null, active: null })}>
          <SelectTrigger aria-label="Фильтр по сроку">
            <SelectValue placeholder="Срок" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все сроки</SelectItem>
            <SelectItem value={DeadlineState.Overdue}>{deadlineStateLabels.overdue}</SelectItem>
            <SelectItem value={DeadlineState.Approaching}>{deadlineStateLabels.approaching}</SelectItem>
            <SelectItem value={DeadlineState.Normal}>{deadlineStateLabels.normal}</SelectItem>
            <SelectItem value={DeadlineState.None}>{deadlineStateLabels.none}</SelectItem>
          </SelectContent>
        </Select>
        {attentionOnly || activeOnly || statusCode !== 'all' ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => patchFilters({ attention: null, active: null, status: null })}
          >
            {attentionOnly ? 'Требуют внимания' : activeOnly ? 'Только активные' : 'Фильтр статуса'}
            <span className="text-muted-foreground">Сбросить</span>
          </Button>
        ) : null}
      </FilterBar>

      {isList ? (
        <OrderListTable
          data={items}
          total={total}
          page={page}
          pageSize={ORDER_PAGE_SIZE}
          sort={listSort}
          direction={listDir}
          isLoading={ordersQuery.isLoading || !filtersReady || listBlockedByBoardPlaceholder}
          error={ordersQuery.error ? getErrorMessage(ordersQuery.error) : null}
          onRetry={() => void ordersQuery.refetch()}
          onPageChange={(next) => patchFilters({ page: next <= 1 ? null : String(next) })}
          onSort={handleListSort}
          onOpenOrder={openOrder}
        />
      ) : ordersQuery.isLoading || !filtersReady ? (
        <LoadingState label="Загрузка доски заказов" />
      ) : ordersQuery.error ? (
        <ErrorState description={getErrorMessage(ordersQuery.error)} />
      ) : (
        <>
          {total > ORDER_BOARD_PAGE_SIZE ? (
            <p className="text-sm text-muted-foreground">
              Показаны последние {ORDER_BOARD_PAGE_SIZE} из {total}. Уточните поиск или фильтр.
            </p>
          ) : null}
          <OrderKanbanBoard orders={items} showClosed={showClosed} onOpenOrder={openOrder} />
        </>
      )}

      {canCreate ? <CreateOrderDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
      <OrderDetailSheet
        orderId={searchParams.get('order')}
        open={Boolean(searchParams.get('order'))}
        onOpenChange={(open) => {
          const next = new URLSearchParams(searchParams)
          if (!open) {
            next.delete('order')
            setSearchParams(next, { replace: true })
          }
        }}
      />
    </div>
  )
}
