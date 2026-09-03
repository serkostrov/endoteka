import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHasPermission } from '@/features/auth'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePageSize } from '@/hooks/use-page-size'
import {
  DOCUMENTS_SEARCH_DEBOUNCE_MS,
  DocumentKind,
  documentKindLabels,
  documentSourceTypeLabels,
  documentStatusLabels,
  documentStatusTone,
} from '@/lib/constants/documents'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { CreateDocumentDialog } from './CreateDocumentDialog'
import { useDocuments } from '../hooks/use-documents'

export function DocumentsScreen() {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize()
  const [createOpen, setCreateOpen] = useState(false)
  const canCreate = useHasPermission(Permission.DocumentsCreate)
  const debouncedSearch = useDebouncedValue(search, DOCUMENTS_SEARCH_DEBOUNCE_MS)
  const documentsQuery = useDocuments({
    search: debouncedSearch,
    kind,
    page,
    pageSize,
  })
  const navigate = useNavigate()
  const total = documentsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Документы"
        description="Акты, накладные и этикетки заполняются из шаблона. Произвольный доступ к базе через поля запрещён."
      />

      <FilterBar
        end={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Новый документ
            </Button>
          ) : null
        }
      >
        <SearchInput
          value={search}
          onChange={(next) => {
            setSearch(next)
            setPage(1)
          }}
          label="Поиск документов"
          placeholder="Номер, название или объект"
        />
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Тип документа">
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {Object.values(DocumentKind).map((code) => (
              <SelectItem key={code} value={code}>
                {documentKindLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        caption="Документы"
        isLoading={documentsQuery.isLoading}
        error={documentsQuery.error ? getErrorMessage(documentsQuery.error) : null}
        data={documentsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Документов нет"
        emptyDescription="Создайте документ из шаблона."
        onRowClick={(row) => navigate(routes.document.replace(':id', row.id))}
        pagination={{
          page,
          pageCount,
          onPageChange: setPage,
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
        columns={[
          { id: 'number', header: 'Номер', cell: (row) => row.number },
          { id: 'title', header: 'Документ', cell: (row) => row.title },
          { id: 'kind', header: 'Тип', cell: (row) => documentKindLabels[row.kind] },
          {
            id: 'object',
            header: 'Объект',
            cell: (row) =>
              row.sourceLabel ? `${documentSourceTypeLabels[row.sourceType]} ${row.sourceLabel}` : '—',
          },
          {
            id: 'status',
            header: 'Статус',
            cell: (row) => (
              <StatusBadge tone={documentStatusTone(row.status)}>{documentStatusLabels[row.status]}</StatusBadge>
            ),
          },
          {
            id: 'created',
            header: 'Дата',
            className: 'hidden md:table-cell',
            cell: (row) => formatDateTime(row.createdAt),
          },
        ]}
      />

      <CreateDocumentDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
