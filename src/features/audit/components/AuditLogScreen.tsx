import { useState } from 'react'

import { DataTable } from '@/components/shared/DataTable'
import { DatePicker } from '@/components/shared/DatePicker'
import { FilterBar } from '@/components/shared/FilterBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'
import {
  AUDIT_SEARCH_DEBOUNCE_MS,
  auditActionFilterGroups,
  auditActionLabel,
  auditEntityTypeFilterOptions,
  auditEntityTypeLabel,
} from '@/lib/constants/audit'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { AuditEventSheet } from './AuditEventSheet'
import { useAuditEvents } from '../hooks/use-audit'
import type { AuditEvent } from '../services/audit-service'

export function AuditLogScreen() {
  const [search, setSearch] = useState('')
  const [actorId, setActorId] = useState('all')
  const [entityType, setEntityType] = useState('all')
  const [action, setAction] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [selected, setSelected] = useState<AuditEvent | null>(null)
  const employees = useActiveEmployees()
  const debouncedSearch = useDebouncedValue(search, AUDIT_SEARCH_DEBOUNCE_MS)
  const eventsQuery = useAuditEvents({
    search: debouncedSearch,
    actorId,
    entityType,
    action,
    fromDate,
    toDate,
    page,
    pageSize,
  })
  const total = eventsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
  }

  function updateFilter<T>(setter: (value: T) => void, value: T) {
    setter(value)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Журнал действий"
        description="История операций только для просмотра. Записи нельзя изменить или удалить."
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={(next) => updateFilter(setSearch, next)}
          label="Поиск по журналу"
          placeholder="Действие, пользователь, объект или IP"
        />
        <Select value={actorId} onValueChange={(value) => updateFilter(setActorId, value)}>
          <SelectTrigger aria-label="Пользователь">
            <SelectValue placeholder="Пользователь" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все пользователи</SelectItem>
            {(employees.data ?? []).map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={entityType} onValueChange={(value) => updateFilter(setEntityType, value)}>
          <SelectTrigger aria-label="Объект">
            <SelectValue placeholder="Объект" />
          </SelectTrigger>
          <SelectContent>
            {auditEntityTypeFilterOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={(value) => updateFilter(setAction, value)}>
          <SelectTrigger aria-label="Действие">
            <SelectValue placeholder="Действие" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все действия</SelectItem>
            {auditActionFilterGroups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.actions.map((code) => (
                  <SelectItem key={code} value={code}>
                    {auditActionLabel(code)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label htmlFor="audit-from" className="text-muted-foreground text-xs font-normal">
            С
          </Label>
          <DatePicker
            id="audit-from"
            value={fromDate}
            onChange={(next) => updateFilter(setFromDate, next)}
            className="w-40"
            aria-label="Дата с"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="audit-to" className="text-muted-foreground text-xs font-normal">
            По
          </Label>
          <DatePicker
            id="audit-to"
            value={toDate}
            onChange={(next) => updateFilter(setToDate, next)}
            className="w-40"
            aria-label="Дата по"
          />
        </div>
      </FilterBar>

      <DataTable
        caption="Журнал действий"
        isLoading={eventsQuery.isLoading}
        error={eventsQuery.error ? getErrorMessage(eventsQuery.error) : null}
        data={eventsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Записей нет"
        emptyDescription="Измените фильтры или период."
        onRowClick={setSelected}
        pagination={{
          page,
          pageCount,
          onPageChange: setPage,
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
        columns={[
          {
            id: 'createdAt',
            header: 'Время',
            className: 'whitespace-nowrap',
            cell: (row) => formatDateTime(row.createdAt),
          },
          {
            id: 'actor',
            header: 'Пользователь',
            cell: (row) => row.actorName,
          },
          {
            id: 'action',
            header: 'Действие',
            cell: (row) => auditActionLabel(row.action),
          },
          {
            id: 'entity',
            header: 'Объект',
            cell: (row) => (
              <span>
                {auditEntityTypeLabel(row.entityType)}
                {row.entityId ? (
                  <span className="text-muted-foreground mt-0.5 block truncate text-xs">{row.entityId}</span>
                ) : null}
              </span>
            ),
          },
        ]}
      />

      <AuditEventSheet event={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  )
}
