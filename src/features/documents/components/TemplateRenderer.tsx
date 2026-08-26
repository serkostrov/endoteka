import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'

import { cn } from '@/lib/utils'

import { buildCode128Path } from '../barcode'
import { interpolateTemplate } from '../interpolate'
import { isPlaceholderKey, placeholderRegistry } from '../placeholders'
import { isSafeHttpUrl } from '../sanitize'
import {
  type DocumentContext,
  type TableBlock,
  type TemplateBlock,
} from '../template-schema'

type TemplateRendererProps = {
  blocks: TemplateBlock[]
  context: DocumentContext
  pageSize: 'a4' | 'label'
  className?: string
}

function mergeValues(base: Record<string, string>, extra: Record<string, string>) {
  return { ...base, ...extra }
}

function tableRows(block: TableBlock, context: DocumentContext) {
  if (block.source === 'order.parts') {
    const rows = context.parts.length > 0 ? context.parts : [{}]
    return rows.map((row) => block.columns.map((cell) => interpolateTemplate(cell, mergeValues(context.values, row))))
  }
  if (block.source === 'sale.lines') {
    const rows = context.lines.length > 0 ? context.lines : [{}]
    return rows.map((row) => block.columns.map((cell) => interpolateTemplate(cell, mergeValues(context.values, row))))
  }
  return block.cells.map((row) => row.map((cell) => interpolateTemplate(cell, context.values)))
}

export function TemplateRenderer({ blocks, context, pageSize, className }: TemplateRendererProps) {
  return (
    <div
      className={cn(
        'document-sheet bg-white text-black',
        pageSize === 'label' ? 'document-sheet-label' : 'document-sheet-a4',
        className,
      )}
    >
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} context={context} compact={pageSize === 'label'} />
      ))}
    </div>
  )
}

function BlockView({
  block,
  context,
  compact,
}: {
  block: TemplateBlock
  context: DocumentContext
  compact: boolean
}) {
  if (block.type === 'heading') {
    const text = interpolateTemplate(block.text, context.values)
    const className = compact
      ? 'font-semibold'
      : block.level === 1
        ? 'mb-3 text-2xl font-semibold'
        : block.level === 2
          ? 'mb-2 mt-4 text-lg font-semibold'
          : 'mb-2 mt-3 text-base font-semibold'
    if (block.level === 1) {
      return <h1 className={className}>{text}</h1>
    }
    if (block.level === 2) {
      return <h2 className={className}>{text}</h2>
    }
    return <h3 className={className}>{text}</h3>
  }

  if (block.type === 'paragraph') {
    return <p className={compact ? 'text-xs' : 'mb-2 text-sm leading-relaxed'}>{interpolateTemplate(block.text, context.values)}</p>
  }

  if (block.type === 'text') {
    return <p className={compact ? 'text-xs' : 'text-sm'}>{interpolateTemplate(block.text, context.values)}</p>
  }

  if (block.type === 'table') {
    const headers = block.headers.map((header) => interpolateTemplate(header, context.values))
    const rows = tableRows(block, context)
    return (
      <table className="mb-3 w-full border-collapse text-sm">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={`${block.id}-h-${index}`} className="border border-black px-2 py-1 text-left font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${block.id}-r-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${block.id}-c-${rowIndex}-${cellIndex}`} className="border border-black px-2 py-1">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (block.type === 'image') {
    const url = interpolateTemplate(block.url, context.values).trim()
    if (!isSafeHttpUrl(url)) {
      return compact ? null : <p className="mb-2 text-xs text-neutral-500">Картинка: укажите http или https адрес.</p>
    }
    return (
      <img
        src={url}
        alt={interpolateTemplate(block.alt, context.values)}
        className={compact ? 'mb-1 max-h-16 max-w-full object-contain' : 'mb-3 max-h-48 max-w-full object-contain'}
        referrerPolicy="no-referrer"
      />
    )
  }

  if (block.type === 'placeholder') {
    const definition = isPlaceholderKey(block.key) ? placeholderRegistry[block.key] : null
    return (
      <p className={compact ? 'text-xs' : 'mb-1 text-sm'}>
        <span className="text-neutral-600">{definition?.label ?? block.key}: </span>
        <span>{context.values[block.key] ?? ''}</span>
      </p>
    )
  }

  if (block.type === 'qr') {
    return <QrCodeImage value={interpolateTemplate(block.value, context.values)} compact={compact} />
  }

  return <BarcodeImage value={interpolateTemplate(block.value, context.values)} />
}

function QrCodeImage({ value, compact }: { value: string; compact: boolean }) {
  const query = useQuery({
    queryKey: ['document-qr', value],
    queryFn: () => QRCode.toDataURL(value, { margin: 1, width: compact ? 128 : 192, errorCorrectionLevel: 'M' }),
    enabled: value.trim().length > 0,
    staleTime: Infinity,
  })

  if (!value.trim()) {
    return <p className="mb-2 text-xs text-neutral-500">QR: нет значения</p>
  }

  if (!query.data) {
    return <div className={compact ? 'mb-1 size-20 border border-dashed' : 'mb-3 size-32 border border-dashed'} />
  }

  return (
    <img
      src={query.data}
      alt=""
      className={compact ? 'mb-1 size-20' : 'mb-3 size-32'}
    />
  )
}

function BarcodeImage({ value }: { value: string }) {
  const path = buildCode128Path(value)
  if (!path) {
    return <p className="mb-2 text-xs text-neutral-500">Штрихкод Code 128: нужны латинские буквы, цифры или знаки.</p>
  }

  return (
    <svg
      role="img"
      aria-label={path.payload}
      viewBox={`0 0 ${path.width} ${path.height + 14}`}
      className="mb-3 h-12 w-full max-w-md"
    >
      <path d={path.d} stroke="black" strokeWidth="1" />
      <text x={path.width / 2} y={path.height + 12} textAnchor="middle" fontSize="10">
        {path.payload}
      </text>
    </svg>
  )
}
