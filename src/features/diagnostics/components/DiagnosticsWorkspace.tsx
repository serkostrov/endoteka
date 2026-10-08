import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { useSheetDirty } from '@/components/ui/sheet'
import { useHasPermission } from '@/features/auth'
import { useRegisterOrderCardSave } from '@/features/orders/lib/order-card-save-context'
import {
  DynamicFieldRenderer,
  DynamicFieldValue,
  DynamicFieldsGrid,
  buildEntityValuesSchema,
  filledFieldValues,
  groupDynamicFields,
} from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { FieldEntity, fieldLayoutWidthClass } from '@/lib/constants/fields'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import type { DynamicFieldDefinition, DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { useOrderDiagnostics, useSaveOrderDiagnostics } from '../hooks/use-diagnostics'

type DiagnosticsWorkspaceProps = {
  orderId: string
}

export function DiagnosticsWorkspace({ orderId }: DiagnosticsWorkspaceProps) {
  const canRead = useHasPermission(Permission.DiagnosticsRead)
  const canUpdate = useHasPermission(Permission.DiagnosticsUpdate)
  const diagnosticsQuery = useOrderDiagnostics(orderId)
  const save = useSaveOrderDiagnostics(orderId)
  const fieldsQuery = useDynamicFields(FieldEntity.Diagnostics)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Diagnostics, orderId)
  const [extraDraft, setExtraDraft] = useState<Record<string, DynamicFieldValueData> | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const extraValues = extraDraft ?? valuesQuery.data ?? {}
  const extraGroups = useMemo(() => groupDynamicFields(activeFields), [activeFields])
  const dirty = canUpdate && extraDraft !== null

  const persistProtocol = useCallback(async () => {
    if (!extraDraft) {
      return
    }

    const values = { ...(valuesQuery.data ?? {}), ...extraDraft }
    const filled = filledFieldValues(activeFields, values)
    const parsed = buildEntityValuesSchema(activeFields).safeParse(filled)
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const code = issue.path[0]
        if (typeof code === 'string' && !nextErrors[code]) {
          nextErrors[code] = issue.message
        }
      }
      setFieldErrors(nextErrors)
      throw new Error('Заполните обязательные поля диагностики.')
    }

    setFieldErrors({})
    setSaving(true)
    try {
      await save.mutateAsync({ fieldValues: parsed.data })
      setExtraDraft(null)
      toast.success('Диагностика сохранена')
    } catch (error) {
      toast.error(getErrorMessage(error))
      throw error
    } finally {
      setSaving(false)
    }
  }, [activeFields, extraDraft, save, valuesQuery.data])

  useSheetDirty(dirty, dirty ? () => persistProtocol() : undefined)

  const saveFromFooter = useCallback(async () => {
    try {
      await persistProtocol()
    } catch {
      // toast already shown
    }
  }, [persistProtocol])

  useRegisterOrderCardSave('diagnostics', {
    dirty,
    saving,
    save: saveFromFooter,
    enabled: canUpdate,
  })

  if (!canRead && !canUpdate) {
    return <ErrorState description="Недостаточно прав для просмотра диагностики." />
  }

  if (diagnosticsQuery.isLoading || fieldsQuery.isLoading || valuesQuery.isLoading) {
    return <LoadingState label="Загрузка диагностики" />
  }

  if (diagnosticsQuery.error) {
    return <ErrorState description={getErrorMessage(diagnosticsQuery.error)} />
  }

  const record = diagnosticsQuery.data

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {record ? `Протокол создан: ${formatDateTime(record.updatedAt)}` : 'Протокол ещё не создан'}
      </p>

      {extraGroups.map((group) => (
        <FieldGroupCard
          key={group.name}
          title={group.name}
          description=""
          fields={group.fields}
          extraValues={extraValues}
          errors={fieldErrors}
          canUpdate={canUpdate}
          onChange={(code, value) => {
            setFieldErrors((current) => {
              if (!current[code]) {
                return current
              }
              const next = { ...current }
              delete next[code]
              return next
            })
            setExtraDraft((current) => ({ ...(current ?? valuesQuery.data ?? {}), [code]: value }))
          }}
        />
      ))}

    </div>
  )
}

function FieldGroupCard({
  title,
  description,
  fields,
  extraValues,
  errors,
  canUpdate,
  onChange,
}: {
  title: string
  description: string
  fields: DynamicFieldDefinition[]
  extraValues: Record<string, DynamicFieldValueData>
  errors: Record<string, string>
  canUpdate: boolean
  onChange: (code: string, value: DynamicFieldValueData) => void
}) {
  return (
    <SectionCard title={title} description={description} flat>
      <DynamicFieldsGrid className="gap-x-4 gap-y-3">
        {fields.map((field) =>
          canUpdate ? (
            <DynamicFieldRenderer
              key={field.id}
              field={field}
              value={extraValues[field.code] ?? emptyFieldValue(field)}
              error={errors[field.code]}
              onChange={(value) => onChange(field.code, value)}
            />
          ) : (
            <div key={field.id} className={cn('space-y-1.5', fieldLayoutWidthClass(field))}>
              <p className="text-sm text-muted-foreground">
                {field.name}
                {field.isRequired ? <span className="text-destructive"> *</span> : null}
              </p>
              <p className="text-sm">
                <DynamicFieldValue field={field} value={extraValues[field.code] ?? emptyFieldValue(field)} />
              </p>
            </div>
          ),
        )}
      </DynamicFieldsGrid>
    </SectionCard>
  )
}
