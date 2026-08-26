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
  ORDER_SEARCH_DEBOUNCE_MS,
} from '@/lib/constants/orders'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { CreateOrderDialog } from './CreateOrderDialog'
import { OrderDetailSheet } from './OrderDetailScreen'
import { OrderKanbanBoard } from './OrderKanbanBoard'
import { useOrders, useOrderStatusCatalog } from '../hooks/use-orders'

function isDeadlineFilter(value: string) {
  return (
    value === 'all' ||
    value === DeadlineState.Overdue ||
    value === DeadlineState.Approaching ||
    value === DeadlineState.Normal ||
    value === DeadlineState.None
  )
}

export function OrdersScreen() {
  const { user } = useAuth()
  const canCreate = useHasPermission(Permission.OrdersCreate)
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, ORDER_SEARCH_DEBOUNCE_MS)

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
  const filtersReady = responsibleParam !== 'me' || Boolean(user?.id)
  const responsibleSelectValue = responsibleParam === 'me' ? (user?.id ?? 'me') : responsibleParam

  const ordersQuery = useOrders(
    {
      search: debouncedSearch,
      statusId: 'all',
      responsibleId: responsibleId || 'all',
      deadlineState,
      activeOnly,
      attentionOnly,
      sort: 'updated',
      direction: 'desc',
      page: 1,
      pageSize: ORDER_BOARD_PAGE_SIZE,
    },
    filtersReady,
  )

  const items = (ordersQuery.data?.items ?? []).filter(
    (order) => statusCode === 'all' || order.statusCode === statusCode,
  )
  const total = ordersQuery.data?.total ?? 0
  const closedStatusIds = new Set(
    (catalogQuery.data ?? [])
      .filter((item) => item.isActive && item.isTerminal)
      .map((item) => item.id),
  )
  const closedCount = items.filter((order) => order.isTerminal || closedStatusIds.has(order.statusId)).length

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
    setSearchParams(next, { replace: true })
  }

  const assignmentFilter = responsibleParam === 'me' ? 'me' : 'all'

  function setAssignmentFilter(next: 'all' | 'me') {
    patchFilters({ responsible: next, attention: null, active: null })
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
        description="Доска ремонта по этапам. Карточка открывается справа."
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый заказ
            </Button>
          ) : null
        }
      />

      <FilterBar
        end={
          <Button
            type="button"
            variant={showClosed ? 'secondary' : 'outline'}
            className="h-9"
            aria-pressed={showClosed}
            onClick={() => patchFilters({ closed: showClosed ? null : '1' })}
          >
            <Archive className="size-4" />
            {showClosed ? 'Скрыть закрытые' : 'Закрытые'}
            {closedCount > 0 ? (
              <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                {closedCount}
              </span>
            ) : null}
          </Button>
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
          onChange={setSearch}
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

      {ordersQuery.isLoading || !filtersReady ? (
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
          <OrderKanbanBoard
            orders={items}
            showClosed={showClosed}
            onOpenOrder={(orderId) => {
              const next = new URLSearchParams(searchParams)
              next.set('order', orderId)
              next.delete('new')
              setSearchParams(next, { replace: true })
            }}
          />
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
