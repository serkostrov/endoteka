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
import { useDocument } from '../hooks/use-documents'
import { downloadDocumentPdf, printDocumentSheets } from '../print-documents'

export function DocumentPrintScreen() {
  const { id } = useParams()
  const documentQuery = useDocument(id)
  const [printing, setPrinting] = useState(false)
  const [downloading, setDownloading] = useState(false)

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

  const printable = {
    title: document.title || 'Документ',
    body: document.body,
    context: document.context,
    pageSize: document.pageSize,
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
      <TemplateRenderer blocks={document.body} context={document.context} pageSize={document.pageSize} />
    </div>
  )
}
