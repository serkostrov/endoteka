import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable } from '@/components/shared/DataTable'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
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
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  DOCUMENTS_SEARCH_DEBOUNCE_MS,
  DocumentKind,
  DocumentPageSize,
  documentKindLabels,
  documentPageSizeLabels,
} from '@/lib/constants/documents'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'

import { useCreateDocumentTemplate, useDeleteDocumentTemplate, useDocumentTemplates } from '../hooks/use-documents'
import { emptyTemplateBody } from '../template-schema'
import type { DocumentTemplateListItem } from '../services/documents-service'

export function TemplatesScreen() {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DocumentTemplateListItem | null>(null)
  const debouncedSearch = useDebouncedValue(search, DOCUMENTS_SEARCH_DEBOUNCE_MS)
  const templatesQuery = useDocumentTemplates(kind, debouncedSearch)
  const remove = useDeleteDocumentTemplate()
  const navigate = useNavigate()

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }

    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Шаблон удалён')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Шаблоны"
        description="Простой редактор блоков: текст, таблицы, картинки по ссылке, QR и штрихкод. Это не текстовый процессор."
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Новый шаблон
          </Button>
        }
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          label="Поиск шаблонов"
          placeholder="Название или код"
        />
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger aria-label="Тип шаблона">
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {Object.values(DocumentKind).map((code) => (
              <SelectItem key={code} value={code}>
                {documentKindLabels[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        caption="Шаблоны"
        isLoading={templatesQuery.isLoading}
        error={templatesQuery.error ? getErrorMessage(templatesQuery.error) : null}
        data={templatesQuery.data ?? []}
        getRowId={(row) => row.id}
        emptyTitle="Шаблонов нет"
        onRowClick={(row) => navigate(routes.documentTemplate.replace(':id', row.id))}
        columns={[
          { id: 'name', header: 'Шаблон', cell: (row) => row.name },
          { id: 'kind', header: 'Тип', cell: (row) => documentKindLabels[row.kind] },
          { id: 'page', header: 'Формат', cell: (row) => documentPageSizeLabels[row.pageSize] },
          {
            id: 'system',
            header: '',
            cell: (row) => (row.isSystem ? <StatusBadge tone="info">Системный</StatusBadge> : null),
          },
          {
            id: 'updated',
            header: 'Обновлён',
            className: 'hidden md:table-cell',
            cell: (row) => formatDateTime(row.updatedAt),
          },
          {
            id: 'actions',
            header: 'Действия',
            className: 'w-[1%] whitespace-nowrap',
            cell: (row) => (
              <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                <IconActionButton
                  label="Изменить"
                  onClick={() => navigate(routes.documentTemplate.replace(':id', row.id))}
                >
                  <Pencil />
                </IconActionButton>
                <IconActionButton
                  label="Удалить"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(row)}
                >
                  <Trash2 />
                </IconActionButton>
              </div>
            ),
          },
        ]}
      />

      <CreateTemplateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить шаблон"
        description={
          deleteTarget ? `${deleteTarget.name} будет удалён без возможности восстановления.` : ''
        }
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}

function CreateTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
          <DialogDescription>Дальше соберёте документ из блоков и сразу увидите превью.</DialogDescription>
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
