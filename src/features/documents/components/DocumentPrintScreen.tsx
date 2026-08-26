import { useParams } from 'react-router-dom'
import { Printer } from 'lucide-react'

import { PageNavControls } from '@/app/layouts/PageNavControls'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'

import { TemplateRenderer } from './TemplateRenderer'
import { useDocument } from '../hooks/use-documents'

export function DocumentPrintScreen() {
  const { id } = useParams()
  const documentQuery = useDocument(id)

  if (documentQuery.isLoading) {
    return <LoadingState label="Подготовка печати" />
  }

  if (documentQuery.error) {
    return <ErrorState description={getErrorMessage(documentQuery.error)} />
  }

  const document = documentQuery.data
  if (!document) {
    return <ErrorState description="Документ не найден." />
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden flex flex-wrap items-center gap-2">
        <PageNavControls />
        <Button type="button" onClick={() => window.print()}>
          <Printer className="size-4" />
          Печать
        </Button>
      </div>
      <TemplateRenderer blocks={document.body} context={document.context} pageSize={document.pageSize} />
    </div>
  )
}
