import { useEffect, useMemo, useState } from 'react'
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
import { useCustomers } from '@/features/customers/hooks/use-customers'
import { useReferenceItemsBySetCode } from '@/features/references/hooks/use-references'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import {
  ORDER_BOARD_PAGE_SIZE,
  ORDER_SEARCH_DEBOUNCE_MS,
} from '@/lib/constants/orders'
import { Permission } from '@/lib/constants/permissions'
import { ReferenceSetCode } from '@/lib/constants/references'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'

import { CreateOrderDialog } from './CreateOrderDialog'
import { OrderBulkActions } from './OrderBulkActions'
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
const CUSTOMER_FILTER_PAGE_SIZE = 200

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
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const debouncedSearch = useDebouncedValue(search, ORDER_SEARCH_DEBOUNCE_MS)
  const [pageSize, setPageSize] = usePageSize()

  const view: OrdersViewMode = searchParams.get('view') === 'kanban' ? 'kanban' : 'list'
  const isList = view === 'list'
  const page = parsePage(searchParams.get('page'))
  const listSort = parseListSort(searchParams.get('sort'))
  const listDir = parseListDir(searchParams.get('dir'))
  const responsibleParam = searchParams.get('responsible') ?? 'all'
  const attentionOnly = searchParams.get('attention') === '1'
  const activeOnly = searchParams.get('active') === '1' && !attentionOnly
  const statusCode = searchParams.get('status') ?? 'all'
  const customerId = searchParams.get('customer') ?? 'all'
  const groupId = searchParams.get('group') ?? 'all'
  const brandId = searchParams.get('brand') ?? 'all'
  const modelId = searchParams.get('model') ?? 'all'

  const employees = useActiveEmployees()
  const catalogQuery = useOrderStatusCatalog()
  const customersQuery = useCustomers('', 1, CUSTOMER_FILTER_PAGE_SIZE)
  const groupsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceGroups)
  const brandsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceBrands)
  const modelsQuery = useReferenceItemsBySetCode(ReferenceSetCode.DeviceModels)

  const responsibleId = responsibleParam === 'me' ? (user?.id ?? '') : responsibleParam
  const filtersReady =
    (responsibleParam !== 'me' || Boolean(user?.id)) &&
    !(isList && statusCode !== 'all' && catalogQuery.isLoading)
  const responsibleSelectValue = responsibleParam === 'me' ? (user?.id ?? 'me') : responsibleParam
  const statusId =
    statusCode !== 'all'
      ? (catalogQuery.data?.find((item) => item.code === statusCode)?.id ?? 'all')
      : 'all'

  const brandOptions = useMemo(() => {
    const items = (brandsQuery.data ?? []).filter((item) => item.isActive)
    if (groupId === 'all') {
      return items
    }
    return items.filter((item) => item.parentId === groupId)
  }, [brandsQuery.data, groupId])

  const modelOptions = useMemo(() => {
    const items = (modelsQuery.data ?? []).filter((item) => item.isActive)
    if (brandId === 'all') {
      if (groupId === 'all') {
        return items
      }
      const brandIds = new Set(brandOptions.map((item) => item.id))
      return items.filter((item) => item.parentId && brandIds.has(item.parentId))
    }
    return items.filter((item) => item.parentId === brandId)
  }, [modelsQuery.data, brandId, brandOptions, groupId])

  const ordersQuery = useOrders(
    {
      search: debouncedSearch,
      statusId,
      responsibleId: responsibleId || 'all',
      deadlineState: 'all',
      customerId,
      groupId,
      brandId,
      modelId,
      activeOnly: isList
        ? !attentionOnly && statusCode === 'all'
        : activeOnly && statusCode === 'all',
      attentionOnly,
      sort: isList ? listSort : 'updated',
      direction: isList ? listDir : 'desc',
      page: isList ? page : 1,
      pageSize: isList ? pageSize : ORDER_BOARD_PAGE_SIZE,
    },
    filtersReady,
  )

  const items = ordersQuery.data?.items ?? []
  const total = ordersQuery.data?.total ?? 0
  const listBlockedByBoardPlaceholder =
    isList && ordersQuery.isPlaceholderData && (ordersQuery.data?.items.length ?? 0) > pageSize

  const pageOrderIdsKey = items.map((order) => order.id).join('|')

  useEffect(() => {
    if (!isList) {
      setSelectedIds([])
      return
    }
    const visible = new Set(pageOrderIdsKey ? pageOrderIdsKey.split('|') : [])
    setSelectedIds((current) => {
      const next = current.filter((id) => visible.has(id))
      return next.length === current.length ? current : next
    })
  }, [isList, pageOrderIdsKey])

  const createOpen = canCreate && searchParams.get('new') === '1'

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    patchFilters({ page: null })
  }

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

  function setGroupFilter(next: string) {
    const brandStillValid =
      next === 'all' ||
      brandId === 'all' ||
      (brandsQuery.data ?? []).some((item) => item.id === brandId && item.parentId === next)
    const nextBrand = brandStillValid ? brandId : 'all'
    const modelStillValid =
      nextBrand === 'all'
        ? modelId === 'all' ||
          (modelsQuery.data ?? []).some((item) => {
            if (item.id !== modelId || !item.parentId) {
              return false
            }
            if (next === 'all') {
              return true
            }
            const parentBrand = (brandsQuery.data ?? []).find((brand) => brand.id === item.parentId)
            return parentBrand?.parentId === next
          })
        : modelId === 'all' ||
          (modelsQuery.data ?? []).some((item) => item.id === modelId && item.parentId === nextBrand)
    patchFilters({
      group: next,
      brand: nextBrand === 'all' ? null : nextBrand,
      model: modelStillValid ? (modelId === 'all' ? null : modelId) : null,
      attention: null,
      active: null,
    })
  }

  function setBrandFilter(next: string) {
    const modelStillValid =
      next === 'all' ||
      modelId === 'all' ||
      (modelsQuery.data ?? []).some((item) => item.id === modelId && item.parentId === next)
    patchFilters({
      brand: next,
      model: modelStillValid ? (modelId === 'all' ? null : modelId) : null,
      attention: null,
      active: null,
    })
  }

  const statusOptions = (catalogQuery.data ?? []).filter((item) => item.isActive)

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

      <div className="space-y-2">
        <FilterBar>
          <SegmentedFilter
            aria-label="Назначение"
            value={assignmentFilter}
            options={[
              { value: 'all', label: 'Все заказы' },
              { value: 'me', label: 'Назначены мне' },
            ]}
            onChange={setAssignmentFilter}
          />
          {attentionOnly || activeOnly ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => patchFilters({ attention: null, active: null })}
            >
              {attentionOnly ? 'Требуют внимания' : 'Только активные'}
              <span className="text-muted-foreground">Сбросить</span>
            </Button>
          ) : null}
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
            className="min-w-[12rem] max-w-none flex-1"
          />
          {canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый заказ
            </Button>
          ) : null}
        </FilterBar>

        <FilterBar className="overflow-visible [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:flex-1 [&_[data-slot=select-trigger]]:shrink">
          <Select
            value={responsibleSelectValue}
            onValueChange={(value) => {
              const next = value === user?.id ? 'me' : value
              patchFilters({ responsible: next, attention: null, active: null })
            }}
          >
            <SelectTrigger aria-label="Фильтр по ответственному" className="w-auto min-w-0 flex-1">
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

          <Select
            value={statusCode}
            onValueChange={(value) => patchFilters({ status: value, attention: null, active: null })}
          >
            <SelectTrigger aria-label="Фильтр по статусу" className="w-auto min-w-0 flex-1">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {statusOptions.map((status) => (
                <SelectItem key={status.id} value={status.code}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={customerId}
            onValueChange={(value) => patchFilters({ customer: value, attention: null, active: null })}
          >
            <SelectTrigger aria-label="Фильтр по клиенту" className="w-auto min-w-0 flex-1">
              <SelectValue placeholder="Клиент" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все клиенты</SelectItem>
              {(customersQuery.data?.items ?? []).map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={groupId} onValueChange={setGroupFilter}>
            <SelectTrigger aria-label="Фильтр по группе прибора" className="w-auto min-w-0 flex-1">
              <SelectValue placeholder="Группа" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все группы</SelectItem>
              {(groupsQuery.data ?? [])
                .filter((item) => item.isActive)
                .map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select value={brandId} onValueChange={setBrandFilter} disabled={groupId !== 'all' && brandOptions.length === 0}>
            <SelectTrigger aria-label="Фильтр по бренду" className="w-auto min-w-0 flex-1">
              <SelectValue placeholder="Бренд" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все бренды</SelectItem>
              {brandOptions.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={modelId}
            onValueChange={(value) => patchFilters({ model: value, attention: null, active: null })}
            disabled={brandId !== 'all' && modelOptions.length === 0}
          >
            <SelectTrigger aria-label="Фильтр по модели" className="w-auto min-w-0 flex-1">
              <SelectValue placeholder="Модель" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все модели</SelectItem>
              {modelOptions.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterBar>
      </div>

      {isList && selectedIds.length > 0 ? (
        <OrderBulkActions selectedIds={selectedIds} onClear={() => setSelectedIds([])} />
      ) : null}

      {isList ? (
        <OrderListTable
          data={items}
          total={total}
          page={page}
          pageSize={pageSize}
          sort={listSort}
          direction={listDir}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          isLoading={ordersQuery.isLoading || !filtersReady || listBlockedByBoardPlaceholder}
          error={ordersQuery.error ? getErrorMessage(ordersQuery.error) : null}
          onRetry={() => void ordersQuery.refetch()}
          onPageChange={(next) => patchFilters({ page: next <= 1 ? null : String(next) })}
          onPageSizeChange={handlePageSizeChange}
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
          <OrderKanbanBoard orders={items} onOpenOrder={openOrder} />
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
