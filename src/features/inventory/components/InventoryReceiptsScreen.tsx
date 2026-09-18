import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { PageHeader } from '@/components/shared/PageHeader'
import { SupplierLink } from '@/components/shared/SupplierLink'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { formatQuantity } from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { usePageSize } from '@/hooks/use-page-size'
import { formatDate, formatDateTime } from '@/lib/utils/date'

import { InventoryReceiptSheet } from './InventoryReceiptSheet'
import { ReceiveStockSheet } from './ReceiveStockSheet'
import { ReceiptDeleteControl } from './ReceiptDeleteControl'
import { useInventoryReceipts } from '../hooks/use-inventory'
import type { InventoryReceiptListItem } from '../services/inventory-service'

export function InventoryReceiptsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [createOpen, setCreateOpen] = useState(false)
  const canReceive = useHasPermission(Permission.InventoryReceive)
  const receiptsQuery = useInventoryReceipts(page, pageSize)
  const receiptId = searchParams.get('receipt')
  const total = receiptsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function openReceipt(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('receipt', id)
    setSearchParams(next, { replace: true })
  }

  function closeReceipt() {
    const next = new URLSearchParams(searchParams)
    next.delete('receipt')
    setSearchParams(next, { replace: true })
  }

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

      <DataTable
        caption="Приходы"
        isLoading={receiptsQuery.isLoading}
        error={receiptsQuery.error ? getErrorMessage(receiptsQuery.error) : null}
        data={receiptsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Приходов нет"
        emptyDescription="Оформите поступление, чтобы появились партии."
        onRowClick={(row) => openReceipt(row.id)}
        pagination={{
          page,
          pageCount,
          onPageChange: setPage,
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
        columns={[
          { id: 'date', header: 'Дата', cell: (row) => formatDate(row.receiptDate) },
          {
            id: 'supplier',
            header: 'Поставщик',
            cell: (row) => <SupplierLink name={row.supplier} customerId={row.supplierId} />,
          },
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
                          if (receiptId === row.id) {
                            closeReceipt()
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
      <InventoryReceiptSheet
        receiptId={receiptId}
        open={Boolean(receiptId)}
        onOpenChange={(open) => {
          if (!open) {
            closeReceipt()
          }
        }}
      />
    </div>
  )
}
