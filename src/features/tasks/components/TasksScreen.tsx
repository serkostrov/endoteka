import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'

import { EmptyState } from '@/components/shared/EmptyState'
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
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Permission } from '@/lib/constants/permissions'
import {
  TASK_PAGE_SIZE,
  TASK_SEARCH_DEBOUNCE_MS,
  TaskDueFilter,
  TaskLinkedFilter,
  TaskPriority,
  TaskStatusFilter,
  taskDueFilterLabels,
  taskLinkedFilterLabels,
  taskPriorityLabels,
} from '@/lib/constants/tasks'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { CreateTaskDialog } from './CreateTaskDialog'
import { TaskListCard } from './TaskListCard'
import { groupTasks } from './task-groups'
import { useTasks } from '../hooks/use-tasks'

function paramIn<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  if (value && (allowed as readonly string[]).includes(value)) {
    return value as T
  }
  return fallback
}

const statusTabs = [
  { id: TaskStatusFilter.Open, label: 'В работе' },
  { id: TaskStatusFilter.Completed, label: 'Выполненные' },
] as const

type AssignmentChip = 'all' | 'to_me' | 'from_me'

export function TasksScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const assigneeParam = searchParams.get('assignee') ?? 'all'
  const status = paramIn(searchParams.get('status'), Object.values(TaskStatusFilter), TaskStatusFilter.Open)
  const [priority, setPriority] = useState('all')
  const due = paramIn(searchParams.get('due'), Object.values(TaskDueFilter), TaskDueFilter.All)
  const [linked, setLinked] = useState<string>(TaskLinkedFilter.All)
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [fromMe, setFromMe] = useState(false)
  const canCreate = useHasPermission(Permission.TasksCreate)
  const employees = useActiveEmployees()
  const debouncedSearch = useDebouncedValue(search, TASK_SEARCH_DEBOUNCE_MS)
  const assigneeId = assigneeParam === 'me' ? (user?.id ?? '') : assigneeParam
  const filtersReady = assigneeParam !== 'me' || Boolean(user?.id)
  const filterKey = `${assigneeParam}|${status}|${due}|${fromMe}`
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey)
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey)
    setPage(1)
  }
  const assigneeSelectValue = assigneeParam === 'me' ? (user?.id ?? 'me') : assigneeParam
  const assignmentChip: AssignmentChip = fromMe ? 'from_me' : assigneeParam === 'me' ? 'to_me' : assigneeParam === 'all' ? 'all' : 'all'
  const tasksQuery = useTasks(
    {
      search: debouncedSearch,
      assigneeId: fromMe ? 'all' : assigneeId || 'all',
      status: status === TaskStatusFilter.All ? TaskStatusFilter.Open : status,
      priority,
      due,
      linked,
      page,
      pageSize: TASK_PAGE_SIZE,
    },
    filtersReady,
  )
  const items = (tasksQuery.data?.items ?? []).filter((task) => !fromMe || task.createdBy === user?.id)
  const total = fromMe ? items.length : (tasksQuery.data?.total ?? 0)
  const pageCount = Math.max(1, Math.ceil((tasksQuery.data?.total ?? 0) / TASK_PAGE_SIZE))
  const groups = groupTasks(items)
  const tabStatus = status === TaskStatusFilter.Completed ? TaskStatusFilter.Completed : TaskStatusFilter.Open

  function patchFilters(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (!value) {
        next.delete(key)
      } else if (value === 'all' && key !== 'status') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    }
    setSearchParams(next, { replace: true })
    setPage(1)
  }

  function setAssignment(chip: AssignmentChip) {
    setFromMe(chip === 'from_me')
    if (chip === 'to_me') {
      patchFilters({ assignee: 'me' })
      return
    }
    patchFilters({ assignee: 'all' })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Задачи"
        description="Назначения, сроки и контроль работ."
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Задача
            </Button>
          ) : null
        }
      />

      <div className="flex gap-1 border-b">
        {statusTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              tabStatus === item.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => {
              setFromMe(false)
              patchFilters({ status: item.id })
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <FilterBar>
        <SegmentedFilter
          aria-label="Назначение"
          value={assignmentChip}
          options={[
            { value: 'all', label: 'Все задачи' },
            { value: 'to_me', label: 'Назначены мне' },
            { value: 'from_me', label: 'Назначены мной' },
          ]}
          onChange={setAssignment}
        />
        <SearchInput
          value={search}
          onChange={(next) => {
            setSearch(next)
            setPage(1)
          }}
          label="Поиск задач"
          placeholder="Название или номер заказа"
        />
        <Select
          value={assigneeSelectValue}
          onValueChange={(value) => {
            setFromMe(false)
            const next = value === user?.id ? 'me' : value
            patchFilters({ assignee: next })
          }}
        >
          <SelectTrigger aria-label="Исполнитель">
            <SelectValue placeholder="Исполнитель" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все исполнители</SelectItem>
            <SelectItem value="unassigned">Без исполнителя</SelectItem>
            {(employees.data ?? []).map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={priority}
          onValueChange={(value) => {
            setPriority(value)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Приоритет">
            <SelectValue placeholder="Приоритет" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все приоритеты</SelectItem>
            {Object.values(TaskPriority).map((code) => (
              <SelectItem key={code} value={code}>
                {taskPriorityLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={due} onValueChange={(value) => patchFilters({ due: value })}>
          <SelectTrigger aria-label="Срок">
            <SelectValue placeholder="Срок" />
          </SelectTrigger>
          <SelectContent>
            {Object.values(TaskDueFilter).map((code) => (
              <SelectItem key={code} value={code}>
                {taskDueFilterLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={linked}
          onValueChange={(value) => {
            setLinked(value)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Связанный заказ">
            <SelectValue placeholder="Заказ" />
          </SelectTrigger>
          <SelectContent>
            {Object.values(TaskLinkedFilter).map((code) => (
              <SelectItem key={code} value={code}>
                {taskLinkedFilterLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {tasksQuery.isLoading || !filtersReady ? (
        <LoadingState label="Загрузка задач" />
      ) : tasksQuery.error ? (
        <ErrorState description={getErrorMessage(tasksQuery.error)} />
      ) : items.length === 0 ? (
        <EmptyState title="Задач нет" description="Создайте задачу или измените фильтры." />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.id} className="space-y-2">
              <h2
                className={cn(
                  'text-sm font-semibold',
                  group.id === 'overdue' ? 'text-destructive' : 'text-foreground',
                )}
              >
                {group.label}
                <span className="ml-1.5 font-normal text-muted-foreground">· {group.items.length}</span>
              </h2>
              <div className="space-y-2">
                {group.items.map((task) => (
                  <TaskListCard key={task.id} task={task} />
                ))}
              </div>
            </section>
          ))}
          {pageCount > 1 ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <p className="text-muted-foreground">
                Стр. {page} из {pageCount}
                {fromMe ? '' : ` · ${total}`}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Назад
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Ещё
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
