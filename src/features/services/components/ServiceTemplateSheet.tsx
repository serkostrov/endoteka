import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getErrorMessage } from '@/lib/errors'

import {
  EditServiceTemplateDialog,
  type ServiceOrderLineContext,
} from './EditServiceTemplateDialog'
import { useServiceTemplate } from '../hooks/use-services'

export function ServiceTemplateSheet({
  templateId,
  open,
  onOpenChange,
  orderLine = null,
}: {
  templateId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Контекст строки заказа — две кнопки сохранения. */
  orderLine?: ServiceOrderLineContext | null
}) {
  const templateQuery = useServiceTemplate(open ? templateId : null)

  if (templateQuery.data) {
    return (
      <EditServiceTemplateDialog
        item={templateQuery.data}
        open={open}
        onOpenChange={onOpenChange}
        orderLine={orderLine}
      />
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Услуга</SheetTitle>
          <SheetDescription>Шаблон из справочника услуг.</SheetDescription>
        </SheetHeader>
        {templateQuery.isLoading ? (
          <LoadingState label="Загрузка" className="py-12 min-h-0" />
        ) : (
          <ErrorState
            title="Услуга не найдена"
            description={
              templateQuery.error ? getErrorMessage(templateQuery.error) : 'Шаблон удалён из справочника.'
            }
            onRetry={() => void templateQuery.refetch()}
            className="py-12"
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
