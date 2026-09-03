import { useState } from 'react'

import { DataTable } from '@/components/shared/DataTable'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { SupplierLink } from '@/components/shared/SupplierLink'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { formatMoney, formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { usePageSize } from '@/hooks/use-page-size'
import { formatDate, formatDateTime } from '@/lib/utils/date'

import { ReceiveStockSheet } from './ReceiveStockSheet'
import { ReceiptDeleteControl } from './ReceiptDeleteControl'
import { useInventoryReceipt, useInventoryReceipts } from '../hooks/use-inventory'
import type { InventoryReceiptListItem } from '../services/inventory-service'

export function InventoryReceiptsScreen() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const receiptsQuery = useInventoryReceipts(page, pageSize)
  const receiptQuery = useInventoryReceipt(selectedId)
  const total = receiptsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Приходы"
        description="Каждый приход создаёт партии. Остаток считается по журналу, не по ручному полю."
        actions={
          canReceive ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый приход
            </Button>
          ) : null
        }
      />

      {selectedId && receiptQuery.data ? (
        <SectionCard
          title={
            <>
              Приход ·{' '}
              <SupplierLink
                name={receiptQuery.data.supplier}
                customerId={receiptQuery.data.supplierId}
              />
            </>
          }
          description={`${formatDate(receiptQuery.data.receiptDate)}${receiptQuery.data.notes ? ` · ${receiptQuery.data.notes}` : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <ReceiptDeleteControl
                receipt={{ id: receiptQuery.data.id, supplier: receiptQuery.data.supplier }}
                variant="button"
                onDeleted={() => setSelectedId(undefined)}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(undefined)}>
                Скрыть
              </Button>
            </div>
          }
        >
          <DataTable
            caption="Строки прихода"
            data={receiptQuery.data.lines}
            getRowId={(row) => row.id}
            emptyTitle="Строк нет"
            columns={[
              { id: 'name', header: 'Позиция', cell: (row) => row.itemName },
              { id: 'code', header: 'Код', cell: (row) => row.itemCode },
              { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(row.quantity) },
              { id: 'price', header: 'Цена', cell: (row) => formatMoney(row.unitPrice) },
              { id: 'left', header: 'Остаток партии', cell: (row) => formatQuantity(row.remainingQuantity) },
            ]}
          />
        </SectionCard>
      ) : null}

      <DataTable
        caption="Приходы"
        isLoading={receiptsQuery.isLoading}
        error={receiptsQuery.error ? getErrorMessage(receiptsQuery.error) : null}
        data={receiptsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Приходов нет"
        emptyDescription="Оформите поступление, чтобы появились партии."
        onRowClick={(row) => setSelectedId(row.id)}
        pagination={{
          page,
          pageCount,
          onPageChange: setPage,
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
        columns={[
          { id: 'date', header: 'Дата', cell: (row) => formatDate(row.receiptDate) },
          { id: 'supplier', header: 'Поставщик', cell: (row) => (
            <SupplierLink name={row.supplier} customerId={row.supplierId} />
          ) },
          { id: 'lines', header: 'Строк', cell: (row) => String(row.lineCount) },
          { id: 'qty', header: 'Кол-во', cell: (row) => formatQuantity(row.totalQuantity) },
          {
            id: 'actor',
            header: 'Кто',
            className: 'hidden md:table-cell',
            cell: (row) => row.actorName || '—',
          },
          {
            id: 'created',
            header: 'Создан',
            className: 'hidden lg:table-cell',
            cell: (row) => formatDateTime(row.createdAt),
          },
          ...(canReceive
            ? [
                {
                  id: 'actions',
                  header: '',
                  className: 'w-[1%] whitespace-nowrap',
                  cell: (row: InventoryReceiptListItem) => (
                    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                      <ReceiptDeleteControl
                        receipt={{ id: row.id, supplier: row.supplier }}
                        onDeleted={() => {
                          if (selectedId === row.id) {
                            setSelectedId(undefined)
                          }
                        }}
                      />
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />

      <ReceiveStockSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
