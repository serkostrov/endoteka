import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Pencil, Printer, Trash2 } from 'lucide-react'
import type { Editor as TinyMCEEditor } from 'tinymce'

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
import { useDocumentSettingsFields } from '@/features/dynamic-fields/hooks/use-fields'

import { TinyMceDocumentEditor } from './TinyMceDocumentEditor'
import { useDeleteDocumentTemplate, useDocumentTemplate, useUpdateDocumentTemplate } from '../hooks/use-documents'
import { htmlTemplateBody, templateHtml } from '../html-template'
import type { DocumentTemplate } from '../services/documents-service'
import {
  normalizePageMargins,
} from '../template-schema'

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

  return <TemplateEditorForm key={template.id} template={template} />
}

function TemplateEditorForm({ template }: { template: DocumentTemplate }) {
  const update = useUpdateDocumentTemplate(template.id)
  const remove = useDeleteDocumentTemplate()
  const navigate = useNavigate()
  const settingsFieldsQuery = useDocumentSettingsFields()
  const editorRef = useRef<TinyMCEEditor | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [name, setName] = useState(template.name)
  const [kind, setKind] = useState(template.kind)
  const [pageSize, setPageSize] = useState(template.pageSize)
  const initialHtml = useMemo(() => templateHtml(template.body), [template.body])
  const [html, setHtml] = useState(initialHtml)
  const htmlBlockId = template.body.find((block) => block.type === 'html')?.id
  const settingsFields = settingsFieldsQuery.data ?? []
  const effectivePageSize = kind === DocumentKind.Label ? DocumentPageSize.Label : pageSize
  const effectiveMargins = normalizePageMargins(
    undefined,
    effectivePageSize === DocumentPageSize.Label ? 'label' : 'a4',
  )

  async function save() {
    try {
      // Берём HTML из редактора — иначе правки отступов/таблиц могут не попасть в React state.
      const content = editorRef.current?.getContent() ?? html
      setHtml(content)
      await update.mutateAsync({
        name,
        kind,
        pageSize: effectivePageSize,
        body: htmlTemplateBody(content, htmlBlockId, effectiveMargins),
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

      <TinyMceDocumentEditor
        value={html}
        onChange={setHtml}
        settingsFields={settingsFields}
        pageSize={effectivePageSize}
        margins={effectiveMargins}
        editorRef={editorRef}
      />

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Свойства шаблона</DialogTitle>
          <DialogDescription>Название и формат листа. Поля страницы фиксированы: 10 мм со всех сторон.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
              <SelectContent searchable>
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
                <SelectContent searchable>
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
