import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { SheetEntityToolbar } from '@/components/shared/SheetEntityToolbar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetExitPresence,
} from '@/components/ui/sheet'
import {
  InventoryCountLineFilter,
  InventoryCountStatus,
  formatQuantity,
  inventoryCountStatusLabels,
  inventoryCountStatusTone,
} from '@/lib/constants/inventory'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

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

/** Загружаем все строки документа без постраничной навигации в UI. */
const COUNT_LINES_PAGE_SIZE = 2000

export function InventoryCountSheet({
  countId,
  open,
  onOpenChange,
}: {
  countId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const presence = useSheetExitPresence(open, countId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? (
        <InventoryCountSheetContent key={presence.id} countId={presence.id} onClose={() => onOpenChange(false)} />
      ) : null}
    </Sheet>
  )
}

function InventoryCountSheetContent({ countId, onClose }: { countId: string; onClose: () => void }) {
  const countQuery = useInventoryCount(countId)
  const remove = useDeleteInventoryCount()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const document = countQuery.data
  const canDelete = Boolean(document && document.status !== InventoryCountStatus.Completed)

  async function handleDelete() {
    if (!document) {
      return
    }
    try {
      await remove.mutateAsync(document.id)
      toast.success('Документ удалён')
      setDeleteOpen(false)
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(96vw,40rem)]"
      actions={
        document ? (
          <SheetEntityToolbar onDelete={canDelete ? () => setDeleteOpen(true) : undefined} />
        ) : null
      }
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Инвентаризация</SheetTitle>
        <SheetDescription>Пересчёт остатков. Список документов остаётся на фоне.</SheetDescription>
      </SheetHeader>
      <div className="p-4 pr-14">
        {countQuery.isLoading ? (
          <LoadingState label="Загрузка инвентаризации" className="min-h-40" />
        ) : countQuery.error ? (
          <ErrorState description={getErrorMessage(countQuery.error)} />
        ) : !document ? (
          <ErrorState description="Документ не найден." />
        ) : (
          <CountDocumentBody document={document} layout="sheet" hideChromeDelete onDeleted={onClose} />
        )}
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title="Удалить инвентаризацию"
        description={document ? `${document.number} будет удалена без возможности восстановления.` : ''}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />
    </SheetContent>
  )
}

const countTabs = [
  { id: 'count' as const, label: 'Пересчёт' },
  { id: 'statement' as const, label: 'Акт расхождений' },
]

function CountDocumentBody({
  document,
  layout,
  onDeleted,
  hideChromeDelete = false,
}: {
  document: InventoryCountDocument
  layout: 'page' | 'sheet'
  onDeleted?: () => void
  hideChromeDelete?: boolean
}) {
  const navigate = useNavigate()
  const editable =
    document.status === InventoryCountStatus.Draft || document.status === InventoryCountStatus.InProgress
  const canDelete = document.status !== InventoryCountStatus.Completed && !hideChromeDelete
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [tab, setTab] = useState<(typeof countTabs)[number]['id']>('count')
  const linesQuery = useInventoryCountLines(
    document.id,
    '',
    InventoryCountLineFilter.All,
    1,
    COUNT_LINES_PAGE_SIZE,
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
  const progress = document.lineCount === 0 ? 0 : Math.round((document.countedCount / document.lineCount) * 100)

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
      if (onDeleted) {
        onDeleted()
      } else {
        navigate(routes.inventoryCounts)
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      {layout === 'page' ? (
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
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{document.number}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {document.completedAt
                ? `Ответственный: ${document.actorName || '—'}. Проведена ${formatDateTime(document.completedAt)}`
                : `Ответственный: ${document.actorName || '—'}. Факт сохраняется по строке, проведение пишет журнал.`}
            </p>
          </div>
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
        </div>
      )}

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
        <SectionCard title="Позиции" className="gap-3 py-4">
          <div className="space-y-3">
            {editable ? (
              <ItemSearchField
                onSelect={(item) => void handleAdd(item)}
                onBarcode={(code) => handleScan(code)}
                searchPlaceholder="Найти или считать штрихкод"
                disabled={addItem.isPending || increment.isPending}
              />
            ) : null}

            <DataTable
              caption="Строки инвентаризации"
              isLoading={linesQuery.isLoading}
              error={linesQuery.error ? getErrorMessage(linesQuery.error) : null}
              onRetry={() => void linesQuery.refetch()}
              data={linesQuery.data?.items ?? []}
              getRowId={(row) => row.id}
              emptyTitle="Позиций нет"
              emptyDescription={editable ? 'Найдите товар выше или считайте штрихкод.' : 'В документе нет строк.'}
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
          </div>
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
      {!hideChromeDelete ? (
        <ConfirmDialog
          open={deleteOpen}
          title="Удалить инвентаризацию"
          description={`${document.number} будет удалена без возможности восстановления.`}
          confirmLabel="Удалить"
          isPending={remove.isPending}
          onOpenChange={setDeleteOpen}
          onConfirm={() => void handleDelete()}
        />
      ) : null}
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
