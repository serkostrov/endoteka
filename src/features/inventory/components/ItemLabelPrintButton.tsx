import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'

import { IconActionButton } from '@/components/shared/IconActionButton'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useHasPermission } from '@/features/auth'
import { useCreateDocument, useDocumentTemplates } from '@/features/documents/hooks/use-documents'
import { openPrintWindow, printDocumentsInWindow } from '@/features/documents/print-documents'
import { getDocument } from '@/features/documents/services/documents-service'
import { DocumentSourceType, sourceTypeForTemplate } from '@/lib/constants/documents'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

type ItemLabelPrintButtonProps = {
  itemId: string
}

export function ItemLabelPrintButton({ itemId }: ItemLabelPrintButtonProps) {
  const canReadDocs = useHasPermission(Permission.DocumentsRead)
  const canCreateDocs = useHasPermission(Permission.DocumentsCreate)
  const canPrintDocs = useHasPermission(Permission.DocumentsPrint)
  const canPrint = canReadDocs || canCreateDocs || canPrintDocs

  const templatesQuery = useDocumentTemplates('all', '')
  const createDoc = useCreateDocument()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState(false)

  const templates = useMemo(
    () =>
      (templatesQuery.data ?? [])
        .filter(
          (template) =>
            sourceTypeForTemplate(template.kind, template.code) === DocumentSourceType.Item,
        )
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, 'ru')),
    [templatesQuery.data],
  )

  if (!canPrint) {
    return null
  }

  async function handlePrint() {
    if (selected.length === 0 || !canCreateDocs) {
      return
    }
    const popup = openPrintWindow()
    if (!popup) {
      toast.error('Разрешите всплывающие окна, чтобы напечатать этикетки.')
      return
    }
    setPending(true)
    try {
      const documents = []
      for (const templateId of selected) {
        const id = await createDoc.mutateAsync({
          templateId,
          sourceType: DocumentSourceType.Item,
          sourceId: itemId,
        })
        documents.push(await getDocument(id))
      }
      await printDocumentsInWindow(popup, documents)
      setOpen(false)
      setSelected([])
      toast.success('Этикетка отправлена на печать')
    } catch (error) {
      popup.close()
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setSelected([])
        }
      }}
    >
      <PopoverTrigger asChild>
        <IconActionButton label="Распечатать этикетку" variant="ghost" size="icon-sm">
          <Printer />
        </IconActionButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="max-h-64 overflow-y-auto py-1">
          {templatesQuery.isLoading ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Загрузка…</p>
          ) : templates.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Нет шаблона «Этикетка запчасти». Добавьте в Настройках → Шаблоны документов.
            </p>
          ) : (
            templates.map((template) => (
              <label
                key={template.id}
                className="hover:bg-accent flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm"
              >
                <Checkbox
                  checked={selected.includes(template.id)}
                  onCheckedChange={() =>
                    setSelected((current) =>
                      current.includes(template.id)
                        ? current.filter((id) => id !== template.id)
                        : [...current, template.id],
                    )
                  }
                  className="mt-0.5"
                />
                <span>{template.name}</span>
              </label>
            ))
          )}
        </div>
        <div className="border-t p-2">
          <Button
            type="button"
            className="w-full"
            disabled={!canCreateDocs || selected.length === 0 || pending}
            onClick={() => void handlePrint()}
          >
            {pending ? 'Подготовка…' : 'Печать'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
