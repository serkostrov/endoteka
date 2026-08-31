import { useState } from 'react'
import { ChevronDown, Printer } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCreateDocument, useDocumentTemplates } from '@/features/documents/hooks/use-documents'
import { openPrintWindow, printDocumentsInWindow } from '@/features/documents/print-documents'
import { getDocument } from '@/features/documents/services/documents-service'
import { useHasPermission } from '@/features/auth'
import { DocumentSourceType, sourceTypeForTemplate } from '@/lib/constants/documents'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'

type OrderPrintMenuProps = {
  orderId: string
}

export function OrderPrintMenu({ orderId }: OrderPrintMenuProps) {
  const canRead = useHasPermission(Permission.DocumentsRead)
  const canCreate = useHasPermission(Permission.DocumentsCreate)
  const canPrint = useHasPermission(Permission.DocumentsPrint)
  const templatesQuery = useDocumentTemplates('all', '')
  const create = useCreateDocument()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState(false)

  if (!canRead && !canCreate && !canPrint) {
    return null
  }

  const templates = (templatesQuery.data ?? [])
    .filter((template) => {
      const source = sourceTypeForTemplate(template.kind, template.code)
      return source === DocumentSourceType.Order || source === DocumentSourceType.None
    })
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'))

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function handlePrint() {
    if (selected.length === 0 || !canCreate) {
      return
    }

    const popup = openPrintWindow()
    if (!popup) {
      toast.error('Разрешите всплывающие окна, чтобы напечатать документ.')
      return
    }

    setPending(true)
    try {
      const documents = []
      for (const templateId of selected) {
        const id = await create.mutateAsync({
          templateId,
          sourceType: DocumentSourceType.Order,
          sourceId: orderId,
        })
        documents.push(await getDocument(id))
      }
      await printDocumentsInWindow(popup, documents)
      setOpen(false)
      setSelected([])
    } catch (error) {
      popup.close()
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-0 px-0" aria-label="Печать">
          <span className="px-2">
            <Printer className="size-4" />
          </span>
          <span className="border-l px-1.5">
            <ChevronDown className="size-3.5" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="max-h-72 overflow-y-auto py-1">
          {templatesQuery.isLoading ? (
            <p className="text-muted-foreground px-3 py-4 text-sm">Загрузка шаблонов…</p>
          ) : templates.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-sm">
              Шаблонов нет. Добавьте их в Настройках → Шаблоны документов.
            </p>
          ) : (
            templates.map((template) => {
              const checked = selected.includes(template.id)
              return (
                <label
                  key={template.id}
                  className="hover:bg-accent flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm"
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(template.id)} className="mt-0.5" />
                  <span>{template.name}</span>
                </label>
              )
            })
          )}
        </div>
        <div className="border-t p-2">
          <Button
            type="button"
            className="w-full"
            disabled={!canCreate || selected.length === 0 || pending}
            onClick={() => void handlePrint()}
          >
            {pending ? 'Подготовка…' : 'Печать'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
