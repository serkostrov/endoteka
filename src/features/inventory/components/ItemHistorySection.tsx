import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { type EntitySheetKind } from '@/app/sheet-stack'
import { DataTable } from '@/components/shared/DataTable'
import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { SectionCard } from '@/components/shared/SectionCard'
import { formatQuantity } from '@/lib/constants/inventory'
import { sheets } from '@/lib/constants/routes'
import { formatDateTime } from '@/lib/utils/date'

import type { InventoryMovement } from '../services/inventory-service'

/** История движений позиции: по действиям, с приходом / выбытием. */
export function ItemHistorySection({ movements }: { movements: InventoryMovement[] }) {
  const rows = useMemo(() => aggregateMovements(movements), [movements])

  return (
    <SectionCard
      className="gap-4 py-5"
      title={
        <span className="inline-flex items-baseline gap-2">
          История
          {rows.length > 0 ? (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {rows.length}
            </span>
          ) : null}
        </span>
      }
      description={rows.length > 0 ? 'Приходы, заказы, продажи и списания' : undefined}
    >
      <DataTable
        caption="История"
        dense
        framed={false}
        maxVisibleRows={8}
        data={rows}
        getRowId={(row) => row.id}
        emptyTitle="Истории пока нет"
        emptyDescription="Появится после прихода, списания в заказ или продажи."
        columns={[
          {
            id: 'action',
            header: 'Действие',
            className: 'w-[9.5rem] align-top',
            cell: (row) => <ActionLink row={row} />,
          },
          {
            id: 'created',
            header: 'Создано',
            className: 'w-[8.5rem] align-top',
            cell: (row) => (
              <div className="min-w-0 leading-snug">
                <p className="truncate text-sm text-foreground">{row.actorName || '—'}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
              </div>
            ),
          },
          {
            id: 'description',
            header: 'Описание',
            className: 'min-w-[10rem] max-w-[18rem] align-top whitespace-normal',
            cell: (row) => <HistoryDescription row={row} />,
          },
          {
            id: 'in',
            header: 'Приход',
            className: 'w-[4.25rem] align-top text-right tabular-nums',
            cell: (row) =>
              row.quantity > 0 ? (
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  {formatQuantity(row.quantity)}
                </span>
              ) : (
                <span className="text-muted-foreground/50">—</span>
              ),
          },
          {
            id: 'out',
            header: 'Уход',
            className: 'w-[3.75rem] align-top text-right tabular-nums',
            cell: (row) =>
              row.quantity < 0 ? (
                <span className="font-medium">{formatQuantity(Math.abs(row.quantity))}</span>
              ) : (
                <span className="text-muted-foreground/50">—</span>
              ),
          },
        ]}
      />
    </SectionCard>
  )
}

function ActionLink({ row }: { row: InventoryMovement }) {
  const navigate = useNavigate()
  const title = (row.documentTitle || row.destination || documentFallback(row)).trim() || 'Действие'
  const sheetKind = sheetKindForReference(row.referenceType)

  if (sheetKind && row.referenceId) {
    return (
      <EntitySheetLink kind={sheetKind} id={row.referenceId} className="font-medium">
        {title}
      </EntitySheetLink>
    )
  }

  if (row.referenceType === 'inventory_write_off' && row.referenceId) {
    return (
      <button
        type="button"
        className="cursor-pointer text-left font-medium text-primary underline-offset-2 hover:underline"
        onClick={(event) => {
          event.stopPropagation()
          navigate(sheets.writeOff(row.referenceId))
        }}
      >
        {title}
      </button>
    )
  }

  return <span className="font-medium text-foreground">{title}</span>
}

function HistoryDescription({ row }: { row: InventoryMovement }) {
  const party = row.counterpartyName.trim() || (row.referenceType === 'receipt' ? row.batchSupplier.trim() : '')
  const bold = (text: string) => <strong className="font-semibold text-foreground">{text}</strong>

  if (row.referenceType === 'order') {
    if (row.quantity < 0) {
      return (
        <p className="text-sm leading-snug break-words text-muted-foreground">
          Со склада · Добавлено в заказ клиенту{party ? <> {bold(party)}</> : null}
        </p>
      )
    }
    return (
      <p className="text-sm leading-snug break-words text-muted-foreground">
        Возврат на склад из заказа{party ? <> · {bold(party)}</> : null}
      </p>
    )
  }

  if (row.referenceType === 'sale') {
    return (
      <p className="text-sm leading-snug break-words text-muted-foreground">
        Со склада · Продажа{party ? <> клиенту {bold(party)}</> : null}
      </p>
    )
  }

  if (row.referenceType === 'receipt') {
    if (row.movementType === 'shortage_cover') {
      return (
        <p className="text-sm leading-snug break-words text-muted-foreground">
          Покрытие недостачи{party ? <> от поставщика {bold(party)}</> : null}
        </p>
      )
    }
    return (
      <p className="text-sm leading-snug break-words text-muted-foreground">
        {party ? <>От поставщика {bold(party)} на склад</> : 'Приход на склад'}
      </p>
    )
  }

  if (row.referenceType === 'inventory_write_off') {
    return (
      <p className="text-sm leading-snug break-words text-muted-foreground">
        {row.quantity > 0 ? 'Возврат на склад · ' : 'Списание со склада · '}
        {party ? bold(party) : 'без причины'}
      </p>
    )
  }

  if (row.referenceType === 'inventory_count' || row.referenceType === 'inventory_adjustment') {
    return (
      <p className="text-sm leading-snug break-words text-muted-foreground">
        {row.referenceType === 'inventory_count' ? 'Пересчёт склада' : 'Корректировка остатка'}
        {party ? <> · {bold(party)}</> : null}
      </p>
    )
  }

  const prefix = row.descriptionPrefix || descriptionFallback(row)
  if (!prefix && !party) {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <p className="text-sm leading-snug break-words text-muted-foreground">
      {prefix}
      {party ? (
        <>
          {prefix ? ' ' : null}
          {bold(party)}
        </>
      ) : null}
    </p>
  )
}

function sheetKindForReference(referenceType: string): EntitySheetKind | null {
  if (referenceType === 'order') return 'order'
  if (referenceType === 'sale') return 'sale'
  if (referenceType === 'receipt') return 'receipt'
  if (referenceType === 'inventory_count') return 'count'
  return null
}

function documentFallback(row: InventoryMovement): string {
  switch (row.referenceType) {
    case 'order':
      return 'Заказ'
    case 'sale':
      return 'Продажа'
    case 'receipt':
      return row.movementType === 'shortage_cover' ? 'Покрытие недостачи' : 'Оприходование'
    case 'inventory_write_off':
      return row.quantity > 0 ? 'Отмена списания' : 'Списание'
    case 'inventory_count':
    case 'inventory_adjustment':
      return 'Инвентаризация'
    default:
      return 'Движение'
  }
}

function descriptionFallback(row: InventoryMovement): string {
  switch (row.referenceType) {
    case 'order':
      return row.quantity < 0 ? 'Со склада · Добавлено в заказ клиенту' : 'Возврат на склад из заказа'
    case 'sale':
      return 'Со склада · Продажа клиенту'
    case 'receipt':
      return row.movementType === 'shortage_cover'
        ? 'Покрытие недостачи от поставщика'
        : 'От поставщика на склад'
    case 'inventory_write_off':
      return row.quantity > 0 ? 'Возврат на склад после отмены списания' : 'Списание со склада'
    case 'inventory_count':
      return 'Пересчёт склада'
    case 'inventory_adjustment':
      return 'Корректировка остатка'
    default:
      return ''
  }
}

/** Несколько FIFO-строк одного документа → одна строка истории. */
export function aggregateMovements(movements: InventoryMovement[]): InventoryMovement[] {
  const byKey = new Map<string, InventoryMovement>()

  for (const movement of movements) {
    const key = `${movement.referenceType}:${movement.referenceId}:${movement.movementType}`
    const current = byKey.get(key)
    if (!current) {
      byKey.set(key, { ...movement })
      continue
    }
    current.quantity += movement.quantity
    if (movement.createdAt > current.createdAt) {
      current.createdAt = movement.createdAt
      if (movement.actorName) current.actorName = movement.actorName
      if (movement.documentTitle) current.documentTitle = movement.documentTitle
      if (movement.counterpartyName) current.counterpartyName = movement.counterpartyName
      if (movement.descriptionPrefix) current.descriptionPrefix = movement.descriptionPrefix
      if (movement.destination) current.destination = movement.destination
    }
  }

  return [...byKey.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
