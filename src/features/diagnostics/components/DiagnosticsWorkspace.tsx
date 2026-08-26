import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingState } from '@/components/shared/LoadingState'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useHasPermission } from '@/features/auth'
import {
  DynamicFieldRenderer,
  DynamicFieldValue,
  buildEntityValuesSchema,
  groupDynamicFields,
} from '@/features/dynamic-fields'
import { emptyFieldValue } from '@/features/dynamic-fields/schemas'
import { useDynamicFieldValues, useDynamicFields } from '@/features/dynamic-fields/hooks/use-fields'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { FieldEntity } from '@/lib/constants/fields'
import { OrderStatusCode } from '@/lib/constants/orders'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/utils/date'
import type { DynamicFieldDefinition, DynamicFieldValueData } from '@/features/dynamic-fields/services/fields-service'

import { DIAGNOSTIC_ENGINEER_NONE } from '../constants'
import { useOrderDiagnostics, useSaveOrderDiagnostics } from '../hooks/use-diagnostics'
import { diagnosticsWorkspaceSchema, engineerIdToNull, type DiagnosticsWorkspaceFormValues } from '../schemas'

type DiagnosticsWorkspaceProps = {
  orderId: string
  statusCode: string
}

export function DiagnosticsWorkspace({ orderId, statusCode }: DiagnosticsWorkspaceProps) {
  const canRead = useHasPermission(Permission.DiagnosticsRead)
  const canUpdate = useHasPermission(Permission.DiagnosticsUpdate)
  const diagnosticsQuery = useOrderDiagnostics(orderId)
  const save = useSaveOrderDiagnostics(orderId)
  const fieldsQuery = useDynamicFields(FieldEntity.Diagnostics)
  const valuesQuery = useDynamicFieldValues(FieldEntity.Diagnostics, orderId)
  const employees = useActiveEmployees()
  const [extraDraft, setExtraDraft] = useState<Record<string, DynamicFieldValueData> | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const activeFields = useMemo(
    () => (fieldsQuery.data ?? []).filter((field) => field.isActive),
    [fieldsQuery.data],
  )
  const extraValues = extraDraft ?? valuesQuery.data ?? {}
  const extraGroups = useMemo(() => groupDynamicFields(activeFields), [activeFields])

  const form = useForm<DiagnosticsWorkspaceFormValues>({
    resolver: zodResolver(diagnosticsWorkspaceSchema),
    values: {
      engineerId: diagnosticsQuery.data?.engineerId ?? DIAGNOSTIC_ENGINEER_NONE,
      conclusion: diagnosticsQuery.data?.conclusion ?? '',
    },
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
  const conclusionEmpty = !(record?.conclusion ?? '').trim()
  const needsConclusionForApproval = statusCode === OrderStatusCode.Diagnostics && conclusionEmpty

  async function onSubmit(values: DiagnosticsWorkspaceFormValues) {
    const extraSchema = buildEntityValuesSchema(activeFields)
    const parsed = extraSchema.safeParse(filledExtraValues(activeFields, extraValues))
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const code = issue.path[0]
        if (typeof code === 'string' && !nextErrors[code]) {
          nextErrors[code] = issue.message
        }
      }
      setFieldErrors(nextErrors)
      toast.error('Заполните обязательные поля протокола.')
      return
    }

    setFieldErrors({})

    try {
      await save.mutateAsync({
        conclusion: values.conclusion,
        engineerId: engineerIdToNull(values.engineerId),
        fieldValues: parsed.data,
      })
      setExtraDraft(null)
      toast.success('Диагностика сохранена')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {needsConclusionForApproval ? (
          <Alert>
            <AlertTitle>Переход в согласование недоступен</AlertTitle>
            <AlertDescription>
              Сначала заполните заключение диагностики и нажмите «Сохранить диагностику». Без заключения заказ нельзя
              перевести из «Диагностика» в «Согласование».
            </AlertDescription>
          </Alert>
        ) : null}

        <SectionCard
          title="Протокол"
          description={
            record
              ? `Сохранён ${formatDateTime(record.updatedAt)}${record.updatedByName ? ` · ${record.updatedByName}` : ''}`
              : 'Заключение и поля протокола сохраняются одной кнопкой. Автосохранения нет.'
          }
        >
          <div className="grid gap-4">
            <FormField
              control={form.control}
              name="engineerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Инженер</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={!canUpdate}>
                    <FormControl>
                      <SelectTrigger className="w-full" aria-label="Инженер">
                        <SelectValue placeholder="Не указан" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={DIAGNOSTIC_ENGINEER_NONE}>Не указан</SelectItem>
                      {(employees.data ?? []).map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="conclusion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Заключение
                    <span className="text-destructive"> *</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={6}
                      disabled={!canUpdate}
                      placeholder="Что обнаружено, что рекомендуется, можно ли ремонтировать."
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Обязательно для перехода «Диагностика → Согласование». Можно сохранить протокол и дописать заключение
                    позже.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SectionCard>

        {extraGroups.map((group) => (
          <FieldGroupCard
            key={group.name}
            title={group.name}
            description="Необязательные сведения. Не заполняйте всё подряд — только то, что нужно для этого прибора."
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

        {canUpdate ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Сохранение…' : 'Сохранить диагностику'}
            </Button>
          </div>
        ) : null}
      </form>
    </Form>
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
    <SectionCard title={title} description={description}>
      <div className="grid gap-4 md:grid-cols-2">
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
            <div key={field.id} className="space-y-1">
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
      </div>
    </SectionCard>
  )
}

function filledExtraValues(
  fields: DynamicFieldDefinition[],
  values: Record<string, DynamicFieldValueData>,
) {
  const result: Record<string, DynamicFieldValueData> = {}
  for (const field of fields) {
    result[field.code] = values[field.code] ?? emptyFieldValue(field)
  }
  return result
}
