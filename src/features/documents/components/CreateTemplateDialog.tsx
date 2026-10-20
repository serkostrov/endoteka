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

import { useCreateDocumentTemplate } from '../hooks/use-documents'
import { emptyLabelTemplateBody, emptyTemplateBody } from '../template-schema'

export function CreateTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateDocumentTemplate()
  const navigate = useNavigate()
  const [name, setName] = useState('Новый шаблон')
  const [kind, setKind] = useState<DocumentKind>(DocumentKind.Custom)
  const [pageSize, setPageSize] = useState<DocumentPageSize>(DocumentPageSize.A4)

  async function submit() {
    try {
      const isLabel = kind === DocumentKind.Label
      const id = await create.mutateAsync({
        name: name.trim() || (isLabel ? 'Этикетка' : 'Новый шаблон'),
        kind,
        pageSize: isLabel ? DocumentPageSize.Label : pageSize,
        body: isLabel ? emptyLabelTemplateBody() : emptyTemplateBody(),
      })
      toast.success(isLabel ? 'Шаблон этикетки создан' : 'Шаблон создан')
      onOpenChange(false)
      setName('Новый шаблон')
      setKind(DocumentKind.Custom)
      setPageSize(DocumentPageSize.A4)
      navigate(routes.documentTemplate.replace(':id', id))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const isLabel = kind === DocumentKind.Label

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый шаблон</DialogTitle>
          <DialogDescription>
            {isLabel
              ? 'Этикетка 58×40 мм. Стартовый макет как на карточке склада — название, код, артикул и штрихкод. Дальше правьте поля в редакторе.'
              : 'Дальше оформите документ в редакторе и вставьте поля из панели.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Название</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={isLabel ? 'Этикетка запчасти' : 'Новый шаблон'}
            />
          </div>
          <div className="space-y-2">
            <Label>Тип</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                const next = value as DocumentKind
                setKind(next)
                if (next === DocumentKind.Label) {
                  setPageSize(DocumentPageSize.Label)
                  if (!name.trim() || name === 'Новый шаблон') {
                    setName('Этикетка')
                  }
                }
              }}
            >
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
          {isLabel ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Формат: <span className="font-medium text-foreground">этикетка 58×40 мм</span>. Печать с
              карточки склада и из списка позиций.
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Формат</Label>
              <Select value={pageSize} onValueChange={(value) => setPageSize(value as DocumentPageSize)}>
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
          )}
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
