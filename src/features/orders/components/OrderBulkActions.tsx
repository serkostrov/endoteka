import { useMemo, useState } from 'react'
import { ChevronDown, Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DatePicker } from '@/components/shared/DatePicker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useHasPermission } from '@/features/auth'
import { useWarrantyDefaults } from '@/features/devices/hooks/use-devices'
import { useCreateDocument, useDocumentTemplates } from '@/features/documents/hooks/use-documents'
import { openPrintWindow, printDocumentsInWindow } from '@/features/documents/print-documents'
import { getDocument } from '@/features/documents/services/documents-service'
import { DocumentSourceType, sourceTypeForTemplate } from '@/lib/constants/documents'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatInteger } from '@/lib/utils/number'

import { useDeleteOrder, useMoveOrderStatus, useOrderStatusCatalog } from '../hooks/use-orders'
import { groupStatusCatalog, statusBadgeStyle, type OrderStatusCatalogItem } from '../lib/status-catalog'

type OrderBulkActionsProps = {
  selectedIds: string[]
  onClear: () => void
}

export function OrderBulkActions({ selectedIds, onClear }: OrderBulkActionsProps) {
  const count = selectedIds.length
  const canDelete = useHasPermission(Permission.OrdersDelete)
  const canChangeStatus =
    useHasPermission(Permission.OrdersChangeStatus) || useHasPermission(Permission.OrdersUpdate)
  const canReadDocs = useHasPermission(Permission.DocumentsRead)
  const canCreateDocs = useHasPermission(Permission.DocumentsCreate)
  const canPrintDocs = useHasPermission(Permission.DocumentsPrint)
  const canPrint = canReadDocs || canCreateDocs || canPrintDocs

  const deleteOrder = useDeleteOrder()
  const moveStatus = useMoveOrderStatus()
  const catalogQuery = useOrderStatusCatalog()
  const templatesQuery = useDocumentTemplates('all', '')
  const createDoc = useCreateDocument()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [printSelected, setPrintSelected] = useState<string[]>([])
  const [printPending, setPrintPending] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusTarget, setStatusTarget] = useState<OrderStatusCatalogItem | null>(null)
  const [warrantyDraft, setWarrantyDraft] = useState<{ start: string; end: string } | null>(null)
  const [statusPending, setStatusPending] = useState(false)

  const isIssue = Boolean(statusTarget?.requiresWarranty)
  const defaultsQuery = useWarrantyDefaults(Boolean(statusTarget) && isIssue)
  const warrantyStart = warrantyDraft?.start ?? defaultsQuery.data?.startsOn ?? ''
  const warrantyEnd = warrantyDraft?.end ?? defaultsQuery.data?.endsOn ?? ''

  const groups = useMemo(
    () => groupStatusCatalog((catalogQuery.data ?? []).filter((item) => item.isActive)),
    [catalogQuery.data],
  )

  const templates = useMemo(
    () =>
      (templatesQuery.data ?? [])
        .filter((template) => {
          const source = sourceTypeForTemplate(template.kind, template.code)
          return source === DocumentSourceType.Order || source === DocumentSourceType.None
        })
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
        await deleteOrder.mutateAsync(id)
      }
      toast.success(
        count === 1 ? 'Заказ удалён' : `Удалено заказов: ${formatInteger(count)}`,
      )
      setDeleteOpen(false)
      onClear()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function applyStatus(status: OrderStatusCatalogItem, warranty?: { start: string; end: string } | null) {
    setStatusPending(true)
    try {
      for (const orderId of selectedIds) {
        await moveStatus.mutateAsync({
          orderId,
          statusId: status.id,
          warranty: status.requiresWarranty ? warranty ?? null : null,
        })
      }
      toast.success(
        count === 1
          ? `Статус: ${status.name}`
          : `Статус «${status.name}» — ${formatInteger(count)} заказ.`,
      )
      setStatusTarget(null)
      setWarrantyDraft(null)
      setStatusOpen(false)
      onClear()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setStatusPending(false)
    }
  }

  async function confirmStatus() {
    if (!statusTarget) {
      return
    }
    if (isIssue && (!warrantyStart || !warrantyEnd)) {
      toast.error('Укажите срок гарантии.')
      return
    }
    await applyStatus(statusTarget, isIssue ? { start: warrantyStart, end: warrantyEnd } : null)
  }

  async function handlePrint() {
    if (printSelected.length === 0 || !canCreateDocs) {
      return
    }
    const popup = openPrintWindow()
    if (!popup) {
      toast.error('Разрешите всплывающие окна, чтобы напечатать документ.')
      return
    }
    setPrintPending(true)
    try {
      const documents = []
      for (const orderId of selectedIds) {
        for (const templateId of printSelected) {
          const id = await createDoc.mutateAsync({
            templateId,
            sourceType: DocumentSourceType.Order,
            sourceId: orderId,
          })
          documents.push(await getDocument(id))
        }
      }
      await printDocumentsInWindow(popup, documents)
      setPrintOpen(false)
      setPrintSelected([])
      toast.success('Документы отправлены на печать')
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
        <p className="mr-1 text-sm font-medium">
          Выбрано: {formatInteger(count)}
        </p>
        {canChangeStatus ? (
          <DropdownMenu open={statusOpen} onOpenChange={setStatusOpen}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                Статус
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
              <DropdownMenuLabel>Новый статус для выбранных</DropdownMenuLabel>
              {catalogQuery.isLoading ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">Загрузка…</p>
              ) : catalogQuery.error ? (
                <p className="px-2 py-1.5 text-sm text-destructive">{getErrorMessage(catalogQuery.error)}</p>
              ) : groups.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">Статусов нет.</p>
              ) : (
                groups.map((group, index) => (
                  <div key={group.id}>
                    {index > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuLabel className="text-xs font-medium text-foreground">
                      {group.name}
                    </DropdownMenuLabel>
                    {group.statuses.map((status) => (
                      <DropdownMenuItem
                        key={status.id}
                        variant={status.isDestructive ? 'destructive' : 'default'}
                        onSelect={() => {
                          if (status.requiresWarranty || status.isDestructive) {
                            setWarrantyDraft(null)
                            setStatusTarget(status)
                            return
                          }
                          void applyStatus(status)
                        }}
                      >
                        <span
                          className="rounded-md px-1.5 py-0.5 text-xs font-medium"
                          style={statusBadgeStyle(status.color || status.groupColor)}
                        >
                          {status.name}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

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
              <Button type="button" variant="outline" size="icon-sm" aria-label="Распечатать">
                <Printer className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-0">
              <div className="max-h-72 overflow-y-auto py-1">
                {templatesQuery.isLoading ? (
                  <p className="text-muted-foreground px-3 py-4 text-sm">Загрузка шаблонов…</p>
                ) : templates.length === 0 ? (
                  <p className="text-muted-foreground px-3 py-4 text-sm">
                    Шаблонов нет. Добавьте их в Настройках → Шаблоны документов.
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
                  disabled={!canCreateDocs || printSelected.length === 0 || printPending}
                  onClick={() => void handlePrint()}
                >
                  {printPending ? 'Подготовка…' : `Печать × ${count}`}
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
        title="Удалить заказы"
        description={
          count === 1
            ? 'Выбранный заказ будет удалён безвозвратно.'
            : `Будет удалено заказов: ${formatInteger(count)}. Действие необратимо.`
        }
        confirmLabel="Удалить"
        confirmVariant="destructive"
        isPending={deleteOrder.isPending}
        onConfirm={() => void handleDelete()}
      />

      <ConfirmDialog
        open={Boolean(statusTarget)}
        onOpenChange={(openDialog) => {
          if (!openDialog) {
            setStatusTarget(null)
            setWarrantyDraft(null)
          }
        }}
        title={
          statusTarget?.isDestructive
            ? 'Отказ'
            : isIssue
              ? 'Выдача и гарантия'
              : 'Сменить статус'
        }
        description={
          statusTarget
            ? isIssue
              ? `Выбранные заказы (${formatInteger(count)}) будут переведены в статус «${statusTarget.name}».`
              : `Выбранные заказы (${formatInteger(count)}) будут переведены в статус «${statusTarget.name}».`
            : ''
        }
        confirmLabel={
          statusTarget?.isDestructive ? 'Подтвердить отказ' : isIssue ? 'Выдать' : 'Сменить статус'
        }
        confirmVariant={statusTarget?.isDestructive ? 'destructive' : 'default'}
        isPending={statusPending}
        onConfirm={() => void confirmStatus()}
      >
        {isIssue ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bulk-warranty-start">Начало гарантии</Label>
              <DatePicker
                id="bulk-warranty-start"
                value={warrantyStart}
                allowClear={false}
                onChange={(next) => setWarrantyDraft({ start: next, end: warrantyEnd })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-warranty-end">Окончание гарантии</Label>
              <DatePicker
                id="bulk-warranty-end"
                value={warrantyEnd}
                allowClear={false}
                onChange={(next) => setWarrantyDraft({ start: warrantyStart, end: next })}
              />
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
