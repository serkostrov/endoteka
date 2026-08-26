import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DataTable } from '@/components/shared/DataTable'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import {
  documentKindLabels,
  documentStatusLabels,
  documentStatusTone,
  DocumentSourceType,
} from '@/lib/constants/documents'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { CreateDocumentDialog } from './CreateDocumentDialog'
import { useDocuments } from '../hooks/use-documents'

type LinkedDocumentSource = typeof DocumentSourceType.Order | typeof DocumentSourceType.Sale | typeof DocumentSourceType.Item

type SourceDocumentsTabProps = {
  sourceType: LinkedDocumentSource
  sourceId: string
  sourceLabel: string
  description: string
  emptyDescription: string
  deniedDescription: string
}

export function SourceDocumentsTab({
  sourceType,
  sourceId,
  sourceLabel,
  description,
  emptyDescription,
  deniedDescription,
}: SourceDocumentsTabProps) {
  const canCreate = useHasPermission(Permission.DocumentsCreate)
  const canRead = useHasPermission(Permission.DocumentsRead)
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()
  const documentsQuery = useDocuments({
    search: '',
    kind: 'all',
    sourceType,
    sourceId,
    page: 1,
    pageSize: 50,
  })

  if (!canRead && !canCreate) {
    return (
      <SectionCard title="Документы">
        <p className="text-sm text-muted-foreground">{deniedDescription}</p>
      </SectionCard>
    )
  }

  return (
    <SectionCard
      title="Документы"
      description={description}
      actions={
        canCreate ? (
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            Создать
          </Button>
        ) : null
      }
    >
      <DataTable
        caption="Документы"
        isLoading={documentsQuery.isLoading}
        error={documentsQuery.error ? getErrorMessage(documentsQuery.error) : null}
        data={documentsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Документов нет"
        emptyDescription={emptyDescription}
        onRowClick={(row) => navigate(routes.document.replace(':id', row.id))}
        columns={[
          { id: 'number', header: 'Номер', cell: (row) => row.number },
          { id: 'title', header: 'Документ', cell: (row) => row.title },
          { id: 'kind', header: 'Тип', cell: (row) => documentKindLabels[row.kind] },
          {
            id: 'status',
            header: 'Статус',
            cell: (row) => (
              <StatusBadge tone={documentStatusTone(row.status)}>{documentStatusLabels[row.status]}</StatusBadge>
            ),
          },
          { id: 'created', header: 'Дата', cell: (row) => formatDateTime(row.createdAt) },
        ]}
      />
      <CreateDocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        presetSourceType={sourceType}
        presetSourceId={sourceId}
        presetSourceLabel={sourceLabel}
      />
    </SectionCard>
  )
}
