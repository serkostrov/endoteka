import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Printer } from 'lucide-react'

import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import {
  DocumentStatus,
  documentKindLabels,
  documentSourceTypeLabels,
  documentStatusLabels,
  documentStatusTone,
} from '@/lib/constants/documents'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { TemplateRenderer } from './TemplateRenderer'
import { useDocument, useIssueDocument } from '../hooks/use-documents'

export function DocumentDetailScreen() {
  const { id } = useParams()
  const documentQuery = useDocument(id)

  if (documentQuery.isLoading) {
    return <LoadingState label="Загрузка документа" />
  }

  if (documentQuery.error) {
    return <ErrorState description={getErrorMessage(documentQuery.error)} />
  }

  const document = documentQuery.data
  if (!document) {
    return <ErrorState description="Документ не найден." />
  }

  return <DocumentBody document={document} />
}

function DocumentBody({
  document,
}: {
  document: NonNullable<ReturnType<typeof useDocument>['data']>
}) {
  const canCreate = useHasPermission(Permission.DocumentsCreate)
  const canPrint = useHasPermission(Permission.DocumentsPrint)
  const issue = useIssueDocument(document.id)

  async function handleIssue() {
    try {
      await issue.mutateAsync()
      toast.success('Документ выпущен')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        className="print:hidden"
        title={document.number}
        description={`${document.title} · ${documentKindLabels[document.kind]}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canPrint ? (
              <Button asChild variant="outline" size="sm">
                <Link to={routes.documentPrint.replace(':id', document.id)}>
                  <Printer className="size-4" />
                  Печать
                </Link>
              </Button>
            ) : null}
            {canCreate && document.status === DocumentStatus.Draft ? (
              <Button type="button" size="sm" disabled={issue.isPending} onClick={() => void handleIssue()}>
                {issue.isPending ? 'Выпуск…' : 'Выпустить'}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="print:hidden flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge tone={documentStatusTone(document.status)}>{documentStatusLabels[document.status]}</StatusBadge>
        <span className="text-muted-foreground">
          {document.sourceLabel
            ? `${documentSourceTypeLabels[document.sourceType]} ${document.sourceLabel}`
            : 'Без объекта'}
        </span>
        <span className="text-muted-foreground">
          {document.createdByName ? `Создал ${document.createdByName}` : ''}
          {` · ${formatDateTime(document.createdAt)}`}
        </span>
      </div>

      <div className="overflow-auto rounded-md border bg-muted/30 p-4 print:border-0 print:bg-transparent print:p-0">
        <TemplateRenderer blocks={document.body} context={document.context} pageSize={document.pageSize} />
      </div>
    </div>
  )
}
