import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, Printer } from 'lucide-react'

import { PageNavControls } from '@/app/layouts/PageNavControls'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'

import { TemplateRenderer } from './TemplateRenderer'
import { useDocumentTemplate } from '../hooks/use-documents'
import { SAMPLE_LINES, SAMPLE_PARTS, SAMPLE_PLACEHOLDER_VALUES } from '../placeholders'
import { downloadDocumentPdf, printDocumentSheets } from '../print-documents'

const sampleContext = {
  values: SAMPLE_PLACEHOLDER_VALUES,
  parts: SAMPLE_PARTS,
  lines: SAMPLE_LINES,
}

export function TemplatePrintScreen() {
  const { id } = useParams()
  const templateQuery = useDocumentTemplate(id)
  const [printing, setPrinting] = useState(false)
  const [downloading, setDownloading] = useState(false)

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

  const printable = {
    title: template.name,
    body: template.body,
    context: sampleContext,
    pageSize: template.pageSize,
  }

  async function handlePrint() {
    setPrinting(true)
    try {
      await printDocumentSheets(printable)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPrinting(false)
    }
  }

  async function handleDownloadPdf() {
    setDownloading(true)
    try {
      await downloadDocumentPdf(printable)
      toast.success('PDF скачан')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PageNavControls />
        <Button type="button" disabled={printing || downloading} onClick={() => void handlePrint()}>
          <Printer className="size-4" />
          {printing ? 'Печать…' : 'Печать'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={printing || downloading}
          onClick={() => void handleDownloadPdf()}
        >
          <Download className="size-4" />
          {downloading ? 'PDF…' : 'Скачать PDF'}
        </Button>
      </div>
      <TemplateRenderer blocks={template.body} context={sampleContext} pageSize={template.pageSize} />
    </div>
  )
}
