import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { cn } from '@/lib/utils'

import { documentMarginsPadding } from '../document-content-style'
import {
  buildQrMap,
  collectAttrValues,
  embedVisualCodes,
  prepareDocumentHtml,
  sanitizeDocumentHtml,
  templateHtml,
} from '../html-template'
import { paginateDocumentHtml } from '../paginate-document-html'
import { templatePageMargins, type DocumentContext, type TemplateBlock } from '../template-schema'

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
  const margins = useMemo(() => templatePageMargins(blocks, pageSize), [blocks, pageSize])
  const markup = useFilledMarkup(html, context)
  const pages = usePaginatedPages(markup, pageSize, margins, variant)
  const padding = documentMarginsPadding(margins)

  if (variant === 'canvas') {
    return (
      <div className={cn('document-sheet document-sheet-canvas document-html bg-white text-black', className)}>
        <div className="document-html-body" dangerouslySetInnerHTML={{ __html: markup }} />
      </div>
    )
  }

  if (pageSize === 'label') {
    return (
      <div
        className={cn('document-sheet document-sheet-label document-html bg-white text-black', className)}
        style={{ padding }}
      >
        <div className="document-html-body" dangerouslySetInnerHTML={{ __html: markup }} />
      </div>
    )
  }

  return (
    <div className={cn('document-print-stack', className)}>
      {pages.map((pageHtml, index) => (
        <section
          key={`page-${index}`}
          className="document-sheet document-sheet-a4 document-html bg-white text-black"
          style={{ padding }}
        >
          <div className="document-html-body" dangerouslySetInnerHTML={{ __html: pageHtml }} />
        </section>
      ))}
    </div>
  )
}

function useFilledMarkup(html: string, context: DocumentContext) {
  const prepared = useMemo(() => prepareDocumentHtml(html, context), [html, context])
  const qrValues = useMemo(() => collectAttrValues(prepared, '.doc-qr'), [prepared])
  const qrQuery = useQuery({
    queryKey: ['document-html-qr', qrValues],
    queryFn: () => buildQrMap(qrValues),
    enabled: qrValues.length > 0,
    staleTime: Infinity,
  })

  return useMemo(
    () => sanitizeDocumentHtml(embedVisualCodes(prepared, qrQuery.data ?? {})),
    [prepared, qrQuery.data],
  )
}

function usePaginatedPages(
  markup: string,
  pageSize: 'a4' | 'label',
  margins: ReturnType<typeof templatePageMargins>,
  variant: 'page' | 'canvas',
) {
  const [pages, setPages] = useState<string[]>([markup])

  useEffect(() => {
    if (variant === 'canvas' || pageSize === 'label' || !markup) {
      setPages([markup])
      return
    }

    const frame = requestAnimationFrame(() => {
      setPages(paginateDocumentHtml(markup, { pageSize, margins }))
    })
    return () => cancelAnimationFrame(frame)
  }, [markup, pageSize, margins, variant])

  return pages
}
