import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Eye, Pencil, Printer, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

import { TemplateRenderer } from './TemplateRenderer'
import { TinyMceDocumentEditor } from './TinyMceDocumentEditor'
import { useDeleteDocumentTemplate, useDocumentTemplate, useUpdateDocumentTemplate } from '../hooks/use-documents'
import { htmlTemplateBody, templateHtml } from '../html-template'
import { SAMPLE_LINES, SAMPLE_PARTS, SAMPLE_PLACEHOLDER_VALUES } from '../placeholders'
import type { DocumentTemplate } from '../services/documents-service'

const sampleContext = {
  values: SAMPLE_PLACEHOLDER_VALUES,
  parts: SAMPLE_PARTS,
  lines: SAMPLE_LINES,
}

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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [name, setName] = useState(template.name)
  const [kind, setKind] = useState(template.kind)
  const [pageSize, setPageSize] = useState(template.pageSize)
  const initialHtml = useMemo(() => templateHtml(template.body), [template.body])
  const [html, setHtml] = useState(initialHtml)
  const htmlBlockId = template.body.find((block) => block.type === 'html')?.id

  async function save() {
    try {
      await update.mutateAsync({
        name,
        kind,
        pageSize: kind === DocumentKind.Label ? DocumentPageSize.Label : pageSize,
        body: htmlTemplateBody(html, htmlBlockId),
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
      setDeleteOpen(false)
      navigate(routes.documentTemplates)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="flex h-[calc(100dvh-1.5rem)] min-h-0 flex-col gap-3 md:h-[calc(100dvh-2rem)]">
      <PageHeader
        className="mb-0 shrink-0 print:hidden sm:items-center"
        title={name || 'Шаблон'}
        description="Поля подставятся при выпуске документа."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
              <Eye className="size-4" />
              Предпросмотр
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={routes.documentTemplatePrint.replace(':id', template.id)}>
                <Printer className="size-4" />
                Печать
              </Link>
            </Button>
            <IconActionButton label="Редактировать" size="icon-sm" onClick={() => setSettingsOpen(true)}>
              <Pencil />
            </IconActionButton>
            <Button type="button" size="sm" disabled={update.isPending} onClick={() => void save()}>
              {update.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
            <IconActionButton
              label="Удалить"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
            </IconActionButton>
          </div>
        }
      />

      <TinyMceDocumentEditor value={html} onChange={setHtml} />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-3 overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Предпросмотр</DialogTitle>
            <DialogDescription>
              Поля заполнены примерами. Несохранённые правки тоже видны.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border bg-white">
            {previewOpen ? (
              <TemplateRenderer
                blocks={htmlTemplateBody(html, htmlBlockId)}
                context={sampleContext}
                pageSize={kind === DocumentKind.Label ? DocumentPageSize.Label : pageSize}
                variant="canvas"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <SettingsDialog
        open={settingsOpen}
        name={name}
        kind={kind}
        pageSize={pageSize}
        onNameChange={setName}
        onKindChange={setKind}
        onPageSizeChange={setPageSize}
        onOpenChange={setSettingsOpen}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Удалить шаблон"
        description={`${template.name} будет удалён без возможности восстановления.`}
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}

function SettingsDialog({
  open,
  name,
  kind,
  pageSize,
  onNameChange,
  onKindChange,
  onPageSizeChange,
  onOpenChange,
}: {
  open: boolean
  name: string
  kind: DocumentKind
  pageSize: DocumentPageSize
  onNameChange: (value: string) => void
  onKindChange: (value: DocumentKind) => void
  onPageSizeChange: (value: DocumentPageSize) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Свойства шаблона</DialogTitle>
          <DialogDescription>Название, тип и формат листа. Сохраняются вместе с макетом.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="template-name">Название</Label>
            <Input id="template-name" value={name} onChange={(event) => onNameChange(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Тип</Label>
            <Select value={kind} onValueChange={(value) => onKindChange(value as DocumentKind)}>
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
          {kind !== DocumentKind.Label ? (
            <div className="space-y-2">
              <Label>Формат</Label>
              <Select value={pageSize} onValueChange={(value) => onPageSizeChange(value as DocumentPageSize)}>
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
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
