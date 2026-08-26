import { useParams } from 'react-router-dom'
import { Printer } from 'lucide-react'

import { PageNavControls } from '@/app/layouts/PageNavControls'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'

import { TemplateRenderer } from './TemplateRenderer'
import { useDocumentTemplate } from '../hooks/use-documents'
import { SAMPLE_LINES, SAMPLE_PARTS, SAMPLE_PLACEHOLDER_VALUES } from '../placeholders'

const sampleContext = {
  values: SAMPLE_PLACEHOLDER_VALUES,
  parts: SAMPLE_PARTS,
  lines: SAMPLE_LINES,
}

export function TemplatePrintScreen() {
  const { id } = useParams()
  const templateQuery = useDocumentTemplate(id)

  if (templateQuery.isLoading) {
    return <LoadingState label="Подготовка печати" />
  }

  if (templateQuery.error) {
    return <ErrorState description={getErrorMessage(templateQuery.error)} />
  }

  const template = templateQuery.data
  if (!template) {
    return <ErrorState description="Шаблон не найден." />
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
      <TemplateRenderer blocks={template.body} context={sampleContext} pageSize={template.pageSize} />
    </div>
  )
}
