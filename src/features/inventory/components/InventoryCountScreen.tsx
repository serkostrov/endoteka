import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { ErrorState } from '@/components/shared/ErrorState'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  INVENTORY_SEARCH_DEBOUNCE_MS,
  InventoryCountLineFilter,
  InventoryCountStatus,
  formatQuantity,
  inventoryCountLineFilterLabels,
  inventoryCountStatusLabels,
  inventoryCountStatusTone,
} from '@/lib/constants/inventory'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'
import { formatDateTime } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

import { BarcodeScanInput } from './BarcodeScanInput'
import { ItemSearchField } from './ItemSearchField'
import {
  useAddInventoryCountItem,
  useCancelInventoryCount,
  useCompleteInventoryCount,
  useDeleteInventoryCount,
  useIncrementInventoryCountItem,
  useInventoryCount,
  useInventoryCountLines,
  useInventoryCountStatement,
  useRemoveInventoryCountLine,
  useSetInventoryCountLineActual,
  useStartInventoryCount,
} from '../hooks/use-inventory'
import type { InventoryCountDocument, InventoryCountLine } from '../services/counts-service'
import { findInventoryItemsByBarcode, type InventoryItem } from '../services/inventory-service'

export function InventoryCountScreen() {
  const { id } = useParams()
  const countQuery = useInventoryCount(id)

  if (countQuery.isLoading) {
    return <LoadingState label="Загрузка инвентаризации" />
  }

  if (countQuery.error) {
    return <ErrorState description={getErrorMessage(countQuery.error)} />
  }

  const document = countQuery.data
  if (!document) {
    return <ErrorState description="Документ не найден." />
  }

  return <CountDocumentBody document={document} />
}

const countTabs = [
  { id: 'count' as const, label: 'Пересчёт' },
  { id: 'statement' as const, label: 'Акт расхождений' },
]

function CountDocumentBody({ document }: { document: InventoryCountDocument }) {
  const navigate = useNavigate()
  const editable =
    document.status === InventoryCountStatus.Draft || document.status === InventoryCountStatus.InProgress
  const canDelete = document.status !== InventoryCountStatus.Completed
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [tab, setTab] = useState<(typeof countTabs)[number]['id']>('count')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<InventoryCountLineFilter>(InventoryCountLineFilter.All)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const debouncedSearch = useDebouncedValue(search, INVENTORY_SEARCH_DEBOUNCE_MS)
  const linesQuery = useInventoryCountLines(
    document.id,
    debouncedSearch,
    filter,
    page,
    pageSize,
  )
  const statementQuery = useInventoryCountStatement(document.id)
  const start = useStartInventoryCount(document.id)
  const cancel = useCancelInventoryCount(document.id)
  const complete = useCompleteInventoryCount(document.id)
  const remove = useDeleteInventoryCount()
  const addItem = useAddInventoryCountItem(document.id)
  const increment = useIncrementInventoryCountItem(document.id)
  const removeLine = useRemoveInventoryCountLine(document.id)
  const setActual = useSetInventoryCountLineActual(document.id)
  const total = linesQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(Number(total) / pageSize))
  const progress = document.lineCount === 0 ? 0 : Math.round((document.countedCount / document.lineCount) * 100)

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
  }

  async function handleScan(code: string) {
    try {
      const items = await findInventoryItemsByBarcode(code)
      const match = items[0]
      if (items.length === 1 && match) {
        await increment.mutateAsync(match.id)
        toast.success(`${match.name}: +1`)
        return
      }
      if (items.length === 0) {
        toast.error('Позиция со штрихкодом не найдена')
        return
      }
      toast.message('Найдено несколько позиций. Выберите вручную.')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleAdd(item: InventoryItem) {
    try {
      await addItem.mutateAsync(item.id)
      toast.success(`Добавлено: ${item.name}`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync(document.id)
      toast.success('Документ удалён')
      setDeleteOpen(false)
      navigate(routes.inventoryCounts)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={document.number}
        description={
          document.completedAt
            ? `Ответственный: ${document.actorName || '—'}. Проведена ${formatDateTime(document.completedAt)}`
            : `Ответственный: ${document.actorName || '—'}. Факт сохраняется по строке, проведение пишет журнал.`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {document.status === InventoryCountStatus.Draft ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={start.isPending}
                onClick={() => {
                  start.mutate(undefined, {
                    onSuccess: () => toast.success('Пересчёт начат'),
                    onError: (error) => toast.error(getErrorMessage(error)),
                  })
                }}
              >
                Начать
              </Button>
            ) : null}
            {editable ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={complete.isPending || document.uncountedCount > 0 || document.lineCount === 0}
                  onClick={() => {
                    complete.mutate(undefined, {
                      onSuccess: () => toast.success('Инвентаризация проведена'),
                      onError: (error) => toast.error(getErrorMessage(error)),
                    })
                  }}
                >
                  {complete.isPending ? 'Проведение…' : 'Провести'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() => {
                    cancel.mutate(undefined, {
                      onSuccess: () => toast.success('Документ отменён'),
                      onError: (error) => toast.error(getErrorMessage(error)),
                    })
                  }}
                >
                  Отменить
                </Button>
              </>
            ) : null}
            {canDelete ? (
              <IconActionButton
                label="Удалить"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
              </IconActionButton>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <StatusBadge tone={inventoryCountStatusTone(document.status)}>
          {inventoryCountStatusLabels[document.status]}
        </StatusBadge>
        <span>
          Пересчитано{' '}
          <span className="font-medium">
            {document.countedCount} из {document.lineCount}
          </span>
        </span>
        <span>
          Не пересчитано <span className="font-medium">{document.uncountedCount}</span>
        </span>
        <span>
          Расхождений{' '}
          <span className={cn('font-medium', document.discrepancyCount > 0 && 'text-destructive')}>
            {document.discrepancyCount}
          </span>
        </span>
        <div className="h-1.5 w-36 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {countTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              tab === item.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'statement' && document.discrepancyCount > 0 ? ` (${document.discrepancyCount})` : ''}
          </button>
        ))}
      </div>

      {tab === 'count' ? (
        <SectionCard
          title="Строки пересчёта"
          description={
            editable
              ? 'Сканер увеличивает факт на 1. Список добавляет позицию в документ. Поиск ниже только фильтрует уже добавленные строки.'
              : 'Таблица позиций этого документа.'
          }
        >
          {editable ? (
            <div className="mb-4 space-y-2">
              <BarcodeScanInput
                autoFocus
                disabled={increment.isPending}
                onScan={(code) => void handleScan(code)}
                placeholder="Считайте штрихкод — факт увеличится на 1"
              />
              <ItemSearchField
                onSelect={(item) => void handleAdd(item)}
                showScan={false}
                searchPlaceholder="Все позиции — введите, чтобы сузить"
                disabled={addItem.isPending}
              />
            </div>
          ) : null}

          <FilterBar className="mb-4">
            <SearchInput
              value={search}
              onChange={(next) => {
                setSearch(next)
                setPage(1)
              }}
              label="Фильтр строк документа"
              placeholder="Найти в этом документе"
            />
            <Select
              value={filter}
              onValueChange={(value) => {
                setFilter(value as InventoryCountLineFilter)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Какие строки показать" className="w-44">
                <SelectValue placeholder="Все строки" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(InventoryCountLineFilter).map((code) => (
                  <SelectItem key={code} value={code}>
                    {inventoryCountLineFilterLabels[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>

          <DataTable
            caption="Строки инвентаризации"
            isLoading={linesQuery.isLoading}
            error={linesQuery.error ? getErrorMessage(linesQuery.error) : null}
            onRetry={() => void linesQuery.refetch()}
            data={linesQuery.data?.items ?? []}
            getRowId={(row) => row.id}
            emptyTitle="Строк нет"
            emptyDescription={editable ? 'Добавьте позиции сканером или из списка номенклатуры.' : 'В документе нет строк.'}
            pagination={{
              page,
              pageCount,
              onPageChange: setPage,
              pageSize,
              onPageSizeChange: handlePageSizeChange,
            }}
            columns={[
              { id: 'name', header: 'Позиция', cell: (row) => row.itemName },
              {
                id: 'code',
                header: 'Код',
                className: 'hidden md:table-cell',
                cell: (row) => row.itemCode,
              },
              { id: 'expected', header: 'Ожидалось', cell: (row) => formatQuantity(row.expectedQuantity) },
              {
                id: 'actual',
                header: 'Факт',
                cell: (row) =>
                  editable ? (
                    <CountActualInput
                      line={row}
                      disabled={setActual.isPending}
                      onSave={(actual) => {
                        setActual.mutate(
                          { lineId: row.id, actual },
                          { onError: (error) => toast.error(getErrorMessage(error)) },
                        )
                      }}
                    />
                  ) : (
                    row.actualQuantity === null ? '—' : formatQuantity(row.actualQuantity)
                  ),
              },
              {
                id: 'diff',
                header: 'Разница',
                cell: (row) => <DifferenceCell difference={row.difference} />,
              },
              {
                id: 'unit',
                header: 'Ед.',
                cell: (row) => row.unitName,
              },
              ...(editable
                ? [
                    {
                      id: 'remove',
                      header: '',
                      cell: (row: InventoryCountLine) => (
                        <IconActionButton
                          label="Убрать"
                          variant="ghost"
                          disabled={removeLine.isPending}
                          onClick={() => {
                            removeLine.mutate(row.id, {
                              onError: (error) => toast.error(getErrorMessage(error)),
                            })
                          }}
                        >
                          <Trash2 />
                        </IconActionButton>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </SectionCard>
      ) : (
        <SectionCard
          title="Акт расхождений"
          description="Сюда попадают только строки, где факт уже заполнен и отличается от ожидаемого остатка."
        >
          <DataTable
            caption="Акт расхождений"
            isLoading={statementQuery.isLoading}
            error={statementQuery.error ? getErrorMessage(statementQuery.error) : null}
            onRetry={() => void statementQuery.refetch()}
            data={statementQuery.data?.lines ?? []}
            getRowId={(row) => row.id}
            emptyTitle="Расхождений нет"
            emptyDescription="После заполнения факта здесь появятся отличия от ожидаемого остатка."
            columns={[
              { id: 'name', header: 'Позиция', cell: (row) => row.itemName },
              { id: 'expected', header: 'Ожидалось', cell: (row) => formatQuantity(row.expectedQuantity) },
              { id: 'actual', header: 'Факт', cell: (row) => formatQuantity(row.actualQuantity) },
              {
                id: 'diff',
                header: 'Разница',
                cell: (row) => <DifferenceCell difference={row.difference} />,
              },
              { id: 'unit', header: 'Ед.', cell: (row) => row.unitName },
              { id: 'actor', header: 'Ответственный', cell: () => document.actorName || '—' },
            ]}
          />
        </SectionCard>
      )}
      <ConfirmDialog
        open={deleteOpen}
        title="Удалить инвентаризацию"
        description={`${document.number} будет удалена без возможности восстановления.`}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}

function DifferenceCell({ difference }: { difference: number | null }) {
  if (difference === null) {
    return <span className="text-muted-foreground">—</span>
  }
  if (difference === 0) {
    return <span>{formatQuantity(0)}</span>
  }
  const label = `${difference > 0 ? '+' : ''}${formatQuantity(difference)}`
  return <span className={difference > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'font-medium text-destructive'}>{label}</span>
}

function CountActualInput({
  line,
  disabled,
  onSave,
}: {
  line: InventoryCountLine
  disabled: boolean
  onSave: (actual: number) => void
}) {
  function commit(raw: string) {
    if (raw.trim() === '') {
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Факт не может быть отрицательным')
      return
    }
    if (parsed === line.actualQuantity) {
      return
    }
    onSave(parsed)
  }

  return (
    <Input
      key={`${line.id}-${line.actualQuantity ?? 'empty'}`}
      type="number"
      min={0}
      step="0.001"
      className="h-8 w-24"
      disabled={disabled}
      defaultValue={line.actualQuantity === null ? '' : String(line.actualQuantity)}
      aria-label={`Факт ${line.itemName}`}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit(event.currentTarget.value)
        }
      }}
    />
  )
}
