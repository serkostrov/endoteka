import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DocumentSourceType,
  documentKindLabels,
  documentSourceTypeLabels,
  sourceTypeForTemplate,
} from '@/lib/constants/documents'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'

import { SourcePicker } from './SourcePicker'
import { useCreateDocument, useDocumentTemplates } from '../hooks/use-documents'

type CreateDocumentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  presetSourceType?: typeof DocumentSourceType.Order | typeof DocumentSourceType.Sale | typeof DocumentSourceType.Item
  presetSourceId?: string
  presetSourceLabel?: string
}

export function CreateDocumentDialog({
  open,
  onOpenChange,
  presetSourceType,
  presetSourceId,
  presetSourceLabel,
}: CreateDocumentDialogProps) {
  const templatesQuery = useDocumentTemplates('all', '')
  const create = useCreateDocument()
  const navigate = useNavigate()
  const [templateId, setTemplateId] = useState('')
  const templates = templatesQuery.data ?? []
  const selected = templates.find((item) => item.id === templateId)
  const sourceType =
    presetSourceType ?? (selected ? sourceTypeForTemplate(selected.kind, selected.code) : DocumentSourceType.None)
  const [source, setSource] = useState({
    sourceId: presetSourceId ?? null,
    sourceLabel: presetSourceLabel ?? '',
  })

  async function submit() {
    if (!templateId) {
      toast.error('Выберите шаблон')
      return
    }
    if (sourceType !== DocumentSourceType.None && !(presetSourceId ?? source.sourceId)) {
      toast.error('Укажите объект документа')
      return
    }
    try {
      const id = await create.mutateAsync({
        templateId,
        sourceType,
        sourceId: sourceType === DocumentSourceType.None ? null : (presetSourceId ?? source.sourceId),
      })
      toast.success('Документ создан')
      onOpenChange(false)
      setTemplateId('')
      navigate(routes.document.replace(':id', id))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новый документ</DialogTitle>
          <DialogDescription>Шаблон заполняется только разрешёнными полями выбранного объекта.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Шаблон</Label>
            <Select
              value={templateId || undefined}
              onValueChange={(value) => {
                setTemplateId(value)
                if (!presetSourceId) {
                  setSource({ sourceId: null, sourceLabel: '' })
                }
              }}
            >
              <SelectTrigger aria-label="Шаблон">
                <SelectValue placeholder="Выберите шаблон" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name} · {documentKindLabels[template.kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && !presetSourceType ? (
            <p className="text-sm text-muted-foreground">Источник: {documentSourceTypeLabels[sourceType]}</p>
          ) : null}
          {sourceType !== DocumentSourceType.None && !presetSourceId ? (
            <div className="space-y-2">
              <Label>{documentSourceTypeLabels[sourceType]}</Label>
              <SourcePicker
                sourceType={sourceType}
                sourceId={source.sourceId}
                sourceLabel={source.sourceLabel}
                onChange={setSource}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" disabled={create.isPending} onClick={() => void submit()}>
            {create.isPending ? 'Создание…' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
