import { useMemo, useState } from 'react'
import { Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
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
import { formatInteger } from '@/lib/utils/number'

import { useRemoveSaleLine } from '../hooks/use-sales'
import type { SaleLine } from '../services/sales-service'

type SaleLinesBulkActionsProps = {
  saleId: string
  selectedIds: string[]
  lines: SaleLine[]
  editable: boolean
  onClear: () => void
}

export function SaleLinesBulkActions({
  saleId,
  selectedIds,
  lines,
  editable,
  onClear,
}: SaleLinesBulkActionsProps) {
  const count = selectedIds.length
  const canDelete = editable
  const canReadDocs = useHasPermission(Permission.DocumentsRead)
  const canCreateDocs = useHasPermission(Permission.DocumentsCreate)
  const canPrintDocs = useHasPermission(Permission.DocumentsPrint)
  const canPrint = canReadDocs || canCreateDocs || canPrintDocs

  const remove = useRemoveSaleLine(saleId)
  const templatesQuery = useDocumentTemplates('all', '')
  const createDoc = useCreateDocument()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [printSelected, setPrintSelected] = useState<string[]>([])
  const [printPending, setPrintPending] = useState(false)

  const selectedLines = useMemo(
    () => lines.filter((line) => selectedIds.includes(line.id)),
    [lines, selectedIds],
  )
  const itemIds = useMemo(
    () => [...new Set(selectedLines.map((line) => line.itemId).filter(Boolean))],
    [selectedLines],
  )

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

  if (count === 0) {
    return null
  }

  async function handleDelete() {
    try {
      for (const id of selectedIds) {
        await remove.mutateAsync(id)
      }
      toast.success(
        count === 1 ? 'Строка удалена' : `Удалено строк: ${formatInteger(count)}`,
      )
      setDeleteOpen(false)
      onClear()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handlePrint() {
    if (printSelected.length === 0 || !canCreateDocs || itemIds.length === 0) {
      return
    }
    const popup = openPrintWindow()
    if (!popup) {
      toast.error('Разрешите всплывающие окна, чтобы напечатать этикетки.')
      return
    }
    setPrintPending(true)
    try {
      const documents = []
      for (const itemId of itemIds) {
        for (const templateId of printSelected) {
          const id = await createDoc.mutateAsync({
            templateId,
            sourceType: DocumentSourceType.Item,
            sourceId: itemId,
          })
          documents.push(await getDocument(id))
        }
      }
      await printDocumentsInWindow(popup, documents)
      setPrintOpen(false)
      setPrintSelected([])
      toast.success('Этикетки отправлены на печать')
    } catch (error) {
      popup.close()
      toast.error(getErrorMessage(error))
    } finally {
      setPrintPending(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <p className="mr-1 text-sm font-medium">Выбрано: {formatInteger(count)}</p>

        {canPrint ? (
          <Popover
            open={printOpen}
            onOpenChange={(next) => {
              setPrintOpen(next)
              if (!next) {
                setPrintSelected([])
              }
            }}
          >
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="icon-sm" aria-label="Распечатать этикетки">
                <Printer className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-0">
              <div className="max-h-72 overflow-y-auto py-1">
                {templatesQuery.isLoading ? (
                  <p className="text-muted-foreground px-3 py-4 text-sm">Загрузка шаблонов…</p>
                ) : templates.length === 0 ? (
                  <p className="text-muted-foreground px-3 py-4 text-sm">
                    Шаблонов этикеток нет. Добавьте «Этикетка запчасти» в Настройках → Шаблоны
                    документов.
                  </p>
                ) : (
                  templates.map((template) => {
                    const checked = printSelected.includes(template.id)
                    return (
                      <label
                        key={template.id}
                        className="hover:bg-accent flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() =>
                            setPrintSelected((current) =>
                              current.includes(template.id)
                                ? current.filter((id) => id !== template.id)
                                : [...current, template.id],
                            )
                          }
                          className="mt-0.5"
                        />
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
                  disabled={
                    !canCreateDocs ||
                    printSelected.length === 0 ||
                    printPending ||
                    itemIds.length === 0
                  }
                  onClick={() => void handlePrint()}
                >
                  {printPending
                    ? 'Подготовка…'
                    : `Печать × ${formatInteger(itemIds.length)}`}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

        {canDelete ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            aria-label="Удалить"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}

        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Снять выбор
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Удалить строки"
        description={
          count === 1
            ? 'Выбранная строка будет удалена из счёта.'
            : `Будет удалено строк: ${formatInteger(count)}.`
        }
        confirmLabel="Удалить"
        confirmVariant="destructive"
        isPending={remove.isPending}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}
