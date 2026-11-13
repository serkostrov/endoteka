import { useSearchParams } from 'react-router-dom'

import { FilterBar } from '@/components/shared/FilterBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { SegmentedFilter } from '@/components/shared/SegmentedFilter'
import { ORDER_SEARCH_DEBOUNCE_MS } from '@/lib/constants/orders'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'
import { cn } from '@/lib/utils'

import { useAssemblies } from '../hooks/use-assembly'
import type { AssemblyTab } from '../services/assembly-service'
import { AssemblyDetailSheet } from './AssemblyDetailScreen'
import { AssemblyListTable } from './AssemblyListTable'

function parsePage(value: string | null) {
  if (!value) {
    return 1
  }
  const page = Number.parseInt(value, 10)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function parseTab(value: string | null): AssemblyTab {
  return value === 'done' ? 'done' : 'active'
}

export function AssemblyOrdersScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))
  const search = searchParams.get('q') ?? ''
  const page = parsePage(searchParams.get('page'))
  const [pageSize, setPageSize] = usePageSize()
  const debouncedSearch = useDebouncedValue(search, ORDER_SEARCH_DEBOUNCE_MS)

  const listQuery = useAssemblies({
    tab,
    search: debouncedSearch.trim(),
    page,
    pageSize,
  })

  function patchFilters(patch: Record<string, string | null>) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === '') {
            next.delete(key)
          } else {
            next.set(key, value)
          }
        }
        return next
      },
      { replace: true },
    )
  }

  function openAssembly(orderId: string) {
    patchFilters({ assembly: orderId })
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-col gap-2">
      <PageHeader
        title="Сборка заказов"
        description="Подготовка запасных частей к ремонту эндоскопического оборудования."
      />

      <div className="space-y-2">
        <FilterBar className="flex-nowrap">
          <SegmentedFilter
            aria-label="Этап сборки"
            value={tab}
            options={[
              { value: 'active', label: 'В процессе сборки' },
              { value: 'done', label: 'Выполненные' },
            ]}
            onChange={(value) => patchFilters({ tab: value === 'active' ? null : value, page: null })}
          />
          <SearchInput
            value={search}
            onChange={(next) => {
              patchFilters({ q: next || null, page: null })
            }}
            label="Поиск сборок"
            placeholder="Номер, клиент или серийный номер"
            className={cn(
              'min-w-0 max-w-none flex-1 sm:min-w-[12rem]',
              search.trim().length > 0 &&
                '[&_input]:border-primary [&_input]:bg-primary/5 [&_input]:ring-[3px] [&_input]:ring-primary/20 [&_svg]:text-primary',
            )}
          />
        </FilterBar>
      </div>

      <AssemblyListTable
        data={listQuery.data?.items ?? []}
        total={listQuery.data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        tab={tab}
        isLoading={listQuery.isLoading || listQuery.isFetching}
        error={listQuery.error ? getErrorMessage(listQuery.error) : null}
        onRetry={() => void listQuery.refetch()}
        onPageChange={(nextPage) => patchFilters({ page: nextPage > 1 ? String(nextPage) : null })}
        onPageSizeChange={(size) => {
          setPageSize(size)
          patchFilters({ page: null })
        }}
        onOpenAssembly={openAssembly}
      />

      <AssemblyDetailSheet
        orderId={searchParams.get('assembly')}
        open={Boolean(searchParams.get('assembly'))}
        onOpenChange={(open) => {
          if (!open) {
            patchFilters({ assembly: null })
          }
        }}
      />
    </div>
  )
}
