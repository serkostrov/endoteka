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
import { emptyTemplateBody } from '../template-schema'

export function CreateTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateDocumentTemplate()
  const navigate = useNavigate()
  const [name, setName] = useState('Новый шаблон')
  const [kind, setKind] = useState<DocumentKind>(DocumentKind.Custom)
  const [pageSize, setPageSize] = useState<DocumentPageSize>(DocumentPageSize.A4)

  async function submit() {
    try {
      const id = await create.mutateAsync({
        name,
        kind,
        pageSize: kind === DocumentKind.Label ? DocumentPageSize.Label : pageSize,
        body: emptyTemplateBody(),
      })
      toast.success('Шаблон создан')
      onOpenChange(false)
      setName('Новый шаблон')
      navigate(routes.documentTemplate.replace(':id', id))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый шаблон</DialogTitle>
          <DialogDescription>Дальше оформите документ в редакторе и вставьте поля из панели.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Название</Label>
            <Input id="tpl-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Тип</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as DocumentKind)}>
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
              <Select value={pageSize} onValueChange={(value) => setPageSize(value as DocumentPageSize)}>
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
