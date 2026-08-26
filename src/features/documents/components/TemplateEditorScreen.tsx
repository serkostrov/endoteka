import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Printer, Trash2 } from 'lucide-react'

import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DocumentKind,
  DocumentPageSize,
  documentKindLabels,
  documentPageSizeLabels,
} from '@/lib/constants/documents'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { PlaceholderComposer, PlaceholderField, PlaceholderKeySelect } from './PlaceholderComposer'
import { TemplateRenderer } from './TemplateRenderer'
import { useDeleteDocumentTemplate, useDocumentTemplate, useUpdateDocumentTemplate } from '../hooks/use-documents'
import {
  SAMPLE_LINES,
  SAMPLE_PARTS,
  SAMPLE_PLACEHOLDER_VALUES,
  placeholderRegistry,
  type PlaceholderInsertContext,
} from '../placeholders'
import {
  TableSource,
  TemplateBlockType,
  createBlock,
  type TableBlock,
  type TemplateBlock,
} from '../template-schema'
import type { DocumentTemplate } from '../services/documents-service'

const sampleContext = {
  values: SAMPLE_PLACEHOLDER_VALUES,
  parts: SAMPLE_PARTS,
  lines: SAMPLE_LINES,
}

const editorTabs = [
  { id: 'editor', label: 'Редактор' },
  { id: 'preview', label: 'Просмотр' },
  { id: 'print', label: 'Печать' },
] as const

type EditorTab = (typeof editorTabs)[number]['id']

const blockButtons: { type: TemplateBlockType; label: string }[] = [
  { type: TemplateBlockType.Heading, label: 'Заголовок' },
  { type: TemplateBlockType.Paragraph, label: 'Абзац' },
  { type: TemplateBlockType.Text, label: 'Текст' },
  { type: TemplateBlockType.Table, label: 'Таблица' },
  { type: TemplateBlockType.Image, label: 'Картинка' },
  { type: TemplateBlockType.Placeholder, label: 'Поле' },
  { type: TemplateBlockType.Qr, label: 'QR' },
  { type: TemplateBlockType.Barcode, label: 'Штрихкод' },
]

export function TemplateEditorScreen() {
  const { id } = useParams()
  const templateQuery = useDocumentTemplate(id)

  if (templateQuery.isLoading) {
    return <LoadingState label="Загрузка шаблона" />
  }

  if (templateQuery.error) {
    return <ErrorState description={getErrorMessage(templateQuery.error)} />
  }

  const template = templateQuery.data
  if (!template) {
    return <ErrorState description="Шаблон не найден." />
  }

  return <TemplateEditorForm key={`${template.id}-${template.updatedAt}`} template={template} />
}

function TemplateEditorForm({ template }: { template: DocumentTemplate }) {
  const update = useUpdateDocumentTemplate(template.id)
  const remove = useDeleteDocumentTemplate()
  const navigate = useNavigate()
  const [tab, setTab] = useState<EditorTab>('editor')
  const [name, setName] = useState(template.name)
  const [kind, setKind] = useState(template.kind)
  const [pageSize, setPageSize] = useState(template.pageSize)
  const [blocks, setBlocks] = useState<TemplateBlock[]>(template.body)
  const [selectedId, setSelectedId] = useState(template.body[0]?.id ?? '')
  const selected = blocks.find((block) => block.id === selectedId) ?? null

  async function save() {
    try {
      await update.mutateAsync({
        name,
        kind,
        pageSize: kind === DocumentKind.Label ? DocumentPageSize.Label : pageSize,
        body: blocks,
      })
      toast.success('Шаблон сохранён')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync(template.id)
      toast.success('Шаблон удалён')
      navigate(routes.documentTemplates)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  function addBlock(type: TemplateBlockType) {
    const next = createBlock(type)
    setBlocks((current) => [...current, next])
    setSelectedId(next.id)
  }

  function patchBlock(next: TemplateBlock) {
    setBlocks((current) => current.map((block) => (block.id === next.id ? next : block)))
  }

  function moveBlock(id: string, direction: -1 | 1) {
    setBlocks((current) => {
      const index = current.findIndex((block) => block.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) {
        return current
      }
      const copy = [...current]
      const [item] = copy.splice(index, 1)
      if (!item) {
        return current
      }
      copy.splice(target, 0, item)
      return copy
    })
  }

  function removeBlock(id: string) {
    setBlocks((current) => current.filter((block) => block.id !== id))
    if (selectedId === id) {
      setSelectedId('')
    }
  }

  const sheet = (
    <TemplateRenderer
      blocks={blocks}
      context={sampleContext}
      pageSize={kind === DocumentKind.Label ? 'label' : pageSize}
    />
  )

  return (
    <div className="space-y-4">
      <PageHeader
        className="print:hidden"
        title={name || 'Шаблон'}
        description="Блоки и плейсхолдеры из списка. HTML и произвольные запросы к базе недоступны."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={routes.documentTemplatePrint.replace(':id', template.id)}>
                <Printer className="size-4" />
                Лист печати
              </Link>
            </Button>
            <IconActionButton
              label="Удалить"
              className="text-destructive hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => void handleDelete()}
            >
              <Trash2 />
            </IconActionButton>
            <Button type="button" size="sm" disabled={update.isPending} onClick={() => void save()}>
              {update.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        }
      />

      <div className="print:hidden flex gap-1 overflow-x-auto border-b">
        {editorTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              'shrink-0 border-b-2 px-3 py-2 text-sm',
              tab === item.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'editor' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <SectionCard title="Свойства">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2 md:col-span-3">
                  <Label htmlFor="template-name">Название</Label>
                  <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Тип</Label>
                  <Select
                    value={kind}
                    onValueChange={(value) => setKind(value as DocumentKind)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(DocumentKind).map((code) => (
                        <SelectItem key={code} value={code}>
                          {documentKindLabels[code]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Формат</Label>
                  <Select
                    value={kind === DocumentKind.Label ? DocumentPageSize.Label : pageSize}
                    onValueChange={(value) => setPageSize(value as DocumentPageSize)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(DocumentPageSize).map((code) => (
                        <SelectItem key={code} value={code}>
                          {documentPageSizeLabels[code]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Блоки" description="Добавьте кусок документа, затем заполните его справа.">
              <div className="mb-3 flex flex-wrap gap-2">
                {blockButtons.map((item) => (
                  <Button key={item.type} type="button" variant="outline" size="sm" onClick={() => addBlock(item.type)}>
                    {item.label}
                  </Button>
                ))}
              </div>
              <ul className="divide-y rounded-md border">
                {blocks.map((block, index) => (
                  <li key={block.id} className="flex items-center gap-2 px-2 py-1">
                    <button
                      type="button"
                      className={cn(
                        'min-w-0 flex-1 rounded px-2 py-1 text-left text-sm',
                        selectedId === block.id ? 'bg-accent font-medium' : 'hover:bg-muted',
                      )}
                      onClick={() => setSelectedId(block.id)}
                    >
                      {blockLabel(block)}
                    </button>
                    <Button type="button" variant="ghost" size="icon-xs" onClick={() => moveBlock(block.id, -1)} disabled={index === 0}>
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => moveBlock(block.id, 1)}
                      disabled={index === blocks.length - 1}
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" onClick={() => removeBlock(block.id)}>
                      <Trash2 className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          <SectionCard title="Настройка блока">
            {selected ? <BlockFields block={selected} onChange={patchBlock} /> : (
              <p className="text-sm text-muted-foreground">Выберите блок слева.</p>
            )}
          </SectionCard>
        </div>
      ) : null}

      {tab === 'preview' ? (
        <div className="overflow-auto rounded-md border bg-muted/30 p-4">{sheet}</div>
      ) : null}

      {tab === 'print' ? (
        <div className="space-y-4">
          <div className="print:hidden">
            <Button type="button" onClick={() => window.print()}>
              <Printer className="size-4" />
              Печать
            </Button>
          </div>
          {sheet}
        </div>
      ) : null}
    </div>
  )
}

function blockLabel(block: TemplateBlock) {
  if (block.type === 'heading') {
    return `Заголовок: ${block.text || '…'}`
  }
  if (block.type === 'paragraph') {
    return `Абзац: ${block.text.slice(0, 40) || '…'}`
  }
  if (block.type === 'text') {
    return `Текст: ${block.text.slice(0, 40) || '…'}`
  }
  if (block.type === 'table') {
    return 'Таблица'
  }
  if (block.type === 'image') {
    return 'Картинка'
  }
  if (block.type === 'placeholder') {
    return `Поле: ${placeholderRegistry[block.key].label}`
  }
  if (block.type === 'qr') {
    return 'QR-код'
  }
  return 'Штрихкод'
}

function BlockFields({
  block,
  onChange,
}: {
  block: TemplateBlock
  onChange: (block: TemplateBlock) => void
}) {
  return (
    <div className="space-y-3">
      {block.type === 'heading' ? (
        <>
          <div className="space-y-2">
            <Label>Уровень</Label>
            <Select value={String(block.level)} onValueChange={(value) => onChange({ ...block, level: Number(value) as 1 | 2 | 3 })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">H1</SelectItem>
                <SelectItem value="2">H2</SelectItem>
                <SelectItem value="3">H3</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <PlaceholderField key={`${block.id}-text`} label="Текст" value={block.text} onChange={(text) => onChange({ ...block, text })} />
        </>
      ) : null}

      {block.type === 'paragraph' || block.type === 'text' ? (
        <PlaceholderField
          key={`${block.id}-text`}
          label="Текст"
          value={block.text}
          onChange={(text) => onChange({ ...block, text })}
          multiline
        />
      ) : null}

      {block.type === 'image' ? (
        <>
          <PlaceholderField key={`${block.id}-url`} label="URL картинки" value={block.url} onChange={(url) => onChange({ ...block, url })} />
          <PlaceholderField key={`${block.id}-alt`} label="Подпись" value={block.alt} onChange={(alt) => onChange({ ...block, alt })} />
        </>
      ) : null}

      {block.type === 'placeholder' ? (
        <PlaceholderKeySelect value={block.key} onChange={(key) => onChange({ ...block, key })} />
      ) : null}

      {block.type === 'qr' || block.type === 'barcode' ? (
        <PlaceholderField key={`${block.id}-value`} label="Значение" value={block.value} onChange={(value) => onChange({ ...block, value })} />
      ) : null}

      {block.type === 'table' ? <TableFields block={block} onChange={onChange} /> : null}
    </div>
  )
}

function tableValueContext(source: TableSource): PlaceholderInsertContext {
  if (source === TableSource.OrderParts) {
    return 'parts'
  }
  if (source === TableSource.SaleLines) {
    return 'lines'
  }
  return 'document'
}

function TableFields({ block, onChange }: { block: TableBlock; onChange: (block: TemplateBlock) => void }) {
  const valueContext = tableValueContext(block.source)

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Источник строк</Label>
        <Select value={block.source} onValueChange={(value) => onChange({ ...block, source: value as TableSource })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TableSource.Manual}>Свои строки</SelectItem>
            <SelectItem value={TableSource.OrderParts}>Запчасти заказа</SelectItem>
            <SelectItem value={TableSource.SaleLines}>Строки накладной</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {block.headers.map((header, index) => (
        <div key={`${block.id}-col-${index}`} className="space-y-2 rounded-md border p-2">
          <PlaceholderField
            label={`Колонка ${index + 1}`}
            value={header}
            onChange={(value) => {
              const headers = [...block.headers]
              headers[index] = value
              onChange({ ...block, headers })
            }}
          />
          {block.source !== TableSource.Manual ? (
            <PlaceholderField
              label="Значение строки"
              value={block.columns[index] ?? ''}
              onChange={(value) => {
                const columns = [...block.columns]
                columns[index] = value
                onChange({ ...block, columns })
              }}
              context={valueContext}
            />
          ) : null}
        </div>
      ))}
      {block.source === TableSource.Manual
        ? block.cells.map((row, rowIndex) => (
            <div key={`${block.id}-row-${rowIndex}`} className="grid gap-2 md:grid-cols-2">
              {row.map((cell, cellIndex) => (
                <PlaceholderComposer
                  key={`${block.id}-cell-${rowIndex}-${cellIndex}`}
                  value={cell}
                  aria-label={`Строка ${rowIndex + 1}, колонка ${cellIndex + 1}`}
                  onChange={(value) => {
                    const cells = block.cells.map((item) => [...item])
                    const target = cells[rowIndex]
                    if (target) {
                      target[cellIndex] = value
                    }
                    onChange({ ...block, cells })
                  }}
                />
              ))}
            </div>
          ))
        : null}
    </div>
  )
}
