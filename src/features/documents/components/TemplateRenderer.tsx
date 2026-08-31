import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { cn } from '@/lib/utils'

import {
  buildQrMap,
  collectAttrValues,
  embedVisualCodes,
  prepareDocumentHtml,
  sanitizeDocumentHtml,
  templateHtml,
} from '../html-template'
import type { DocumentContext, TemplateBlock } from '../template-schema'

type TemplateRendererProps = {
  blocks: TemplateBlock[]
  context: DocumentContext
  pageSize: 'a4' | 'label'
  variant?: 'page' | 'canvas'
  className?: string
}

export function TemplateRenderer({
  blocks,
  context,
  pageSize,
  variant = 'page',
  className,
}: TemplateRendererProps) {
  const html = templateHtml(blocks)
  const sheetClass =
    variant === 'canvas'
      ? 'document-sheet-canvas'
      : pageSize === 'label'
        ? 'document-sheet-label'
        : 'document-sheet-a4'

  return (
    <div className={cn('document-sheet document-html bg-white text-black', sheetClass, className)}>
      <HtmlDocument html={html} context={context} />
    </div>
  )
}

function HtmlDocument({ html, context }: { html: string; context: DocumentContext }) {
  const prepared = useMemo(() => prepareDocumentHtml(html, context), [html, context])
  const qrValues = useMemo(() => collectAttrValues(prepared, '.doc-qr'), [prepared])
  const qrQuery = useQuery({
    queryKey: ['document-html-qr', qrValues],
    queryFn: () => buildQrMap(qrValues),
    enabled: qrValues.length > 0,
    staleTime: Infinity,
  })

  const markup = useMemo(
    () => sanitizeDocumentHtml(embedVisualCodes(prepared, qrQuery.data ?? {})),
    [prepared, qrQuery.data],
  )

  return <div className="document-html-body" dangerouslySetInnerHTML={{ __html: markup }} />
}
