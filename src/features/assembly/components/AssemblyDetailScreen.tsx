import { useCallback, useState } from 'react'
import { ExternalLink, History, X } from 'lucide-react'
import { toast } from 'sonner'

import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { ErrorState } from '@/components/shared/ErrorState'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useSheetDirty,
  useSheetExitPresence,
} from '@/components/ui/sheet'
import { deviceSerialLine } from '@/features/devices/classification'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { useAssembly, useSaveAssemblyParts } from '../hooks/use-assembly'
import { AssemblyPartsDraftProvider, useAssemblyPartsDraft } from '../lib/assembly-parts-draft'
import { getAssembly, type AssemblyDetail } from '../services/assembly-service'
import { AssemblyActivityFeed } from './AssemblyActivityFeed'
import { AssemblyCompletenessBadge } from './AssemblyCompletenessBadge'
import { AssemblyPartsBlock } from './AssemblyPartsBlock'
import { AssemblyPrintButton } from './AssemblyPrintButton'

export function AssemblyDetailSheet({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const presence = useSheetExitPresence(open, orderId)
  return (
    <Sheet open={presence.open} onOpenChange={onOpenChange}>
      {presence.id ? <AssemblyDetailSheetContent key={presence.id} orderId={presence.id} /> : null}
    </Sheet>
  )
}

function AssemblyDetailSheetContent({ orderId }: { orderId: string }) {
  const assemblyQuery = useAssembly(orderId)
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <SheetContent
      side="right"
      showCloseButton={false}
      className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,72rem)]"
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Сборка заказа</SheetTitle>
        <SheetDescription>Подготовка запасных частей к ремонту.</SheetDescription>
      </SheetHeader>
      {assemblyQuery.isLoading ? (
        <LoadingState label="Загрузка сборки" className="min-h-64" />
      ) : assemblyQuery.error ? (
        <ErrorState description={getErrorMessage(assemblyQuery.error)} />
      ) : !assemblyQuery.data ? (
        <ErrorState description="Сборка не найдена." />
      ) : (
        <AssemblyPartsDraftProvider serverParts={assemblyQuery.data.parts}>
          <AssemblyDetailCard
            assembly={assemblyQuery.data}
            historyOpen={historyOpen}
            onHistoryOpenChange={setHistoryOpen}
          />
        </AssemblyPartsDraftProvider>
      )}
    </SheetContent>
  )
}

function AssemblyDetailCard({
  assembly,
  historyOpen,
  onHistoryOpenChange,
}: {
  assembly: AssemblyDetail
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
}) {
  const canEdit = useHasPermission(Permission.OrdersUpdate)
  const { parts, dirty, completenessPct, toSavePayload, resetFromServer } = useAssemblyPartsDraft()
  const saveParts = useSaveAssemblyParts(assembly.id)
  const [saving, setSaving] = useState(false)
  const serial = deviceSerialLine(assembly.serialNumber)

  const persist = useCallback(async () => {
    if (!dirty) {
      return
    }
    setSaving(true)
    try {
      await saveParts.mutateAsync(toSavePayload())
      const detail = await getAssembly(assembly.id)
      resetFromServer(detail.parts)
      toast.success('Сборка сохранена')
    } catch (error) {
      toast.error(getErrorMessage(error))
      throw error
    } finally {
      setSaving(false)
    }
  }, [assembly.id, dirty, resetFromServer, saveParts, toSavePayload])

  useSheetDirty(dirty, persist)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold tracking-tight">
              Сборка заказа {assembly.number}
            </h2>
            <AssemblyCompletenessBadge pct={completenessPct} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EntitySheetLink
              kind="order"
              id={assembly.id}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Открыть заказ
              <ExternalLink className="size-3.5" />
            </EntitySheetLink>
            <AssemblyPrintButton
              assembly={{
                ...assembly,
                completenessPct,
                parts: parts.map((part) => ({
                  id: part.serverId ?? part.key,
                  name: part.name,
                  qtyRequired: part.qtyRequired,
                  qtyCollected: part.qtyCollected,
                  comment: part.comment,
                  sortOrder: part.sortOrder,
                  createdAt: '',
                  updatedAt: '',
                })),
              }}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconActionButton
            className="lg:hidden"
            label="История"
            onClick={() => onHistoryOpenChange(true)}
          >
            <History className="size-4" />
          </IconActionButton>
          <SheetClose asChild>
            <IconActionButton label="Закрыть">
              <X className="size-4" />
            </IconActionButton>
          </SheetClose>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadonlyCard
                title="Прибор"
                name={assembly.deviceLabel || '—'}
                detail={serial || undefined}
              />
              <ReadonlyCard title="Клиент" name={assembly.customerName || '—'} />
            </div>

            <section className="rounded-lg border bg-background p-3">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Заключение
              </p>
              <p
                className={cn(
                  'mt-1 whitespace-pre-wrap text-sm',
                  !assembly.conclusion && 'text-muted-foreground',
                )}
              >
                {assembly.conclusion || 'Заключение диагностики не заполнено.'}
              </p>
            </section>

            <AssemblyPartsBlock />
          </div>
        </div>

        <aside className="hidden w-[22rem] shrink-0 border-l lg:flex lg:flex-col">
          <AssemblyActivityFeed orderId={assembly.id} orderNumber={assembly.number} />
        </aside>
      </div>

      {canEdit && (dirty || saving) ? (
        <footer className="flex items-center justify-between gap-3 border-t px-4 py-3">
          <Button
            type="button"
            disabled={saving || !dirty}
            onClick={() => {
              void persist().catch(() => undefined)
            }}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
          <p className="text-xs text-muted-foreground">Есть несохранённые изменения</p>
        </footer>
      ) : null}

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background lg:hidden">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-medium">История сборки</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => onHistoryOpenChange(false)}>
              Закрыть
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <AssemblyActivityFeed
              orderId={assembly.id}
              orderNumber={assembly.number}
              hideHeader
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ReadonlyCard({
  title,
  name,
  detail,
}: {
  title: string
  name: string
  detail?: string
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <p className="mt-1 truncate text-sm font-medium">{name}</p>
      {detail ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  )
}
