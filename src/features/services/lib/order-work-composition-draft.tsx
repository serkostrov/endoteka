import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  useOrderInventoryUsage,
} from '@/features/inventory/hooks/use-inventory'
import {
  addOrderCustomPartLine,
  consumeInventoryForOrder,
  removeOrderPartLine,
  setOrderPartLine,
  updateOrderCustomPartLine,
  type InventoryItem,
  type OrderInventoryUsage,
} from '@/features/inventory/services/inventory-service'
import {
  buildEntityValuesSchema,
  filledFieldValues,
  saveDynamicFieldValues,
} from '@/features/dynamic-fields'
import type {
  DynamicFieldDefinition,
  DynamicFieldValueData,
} from '@/features/dynamic-fields/services/fields-service'
import { useRegisterOrderCardSave } from '@/features/orders/lib/order-card-save-context'
import { useSheetDirty } from '@/components/ui/sheet'
import { FieldEntity } from '@/lib/constants/fields'
import { getErrorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { getSupabase } from '@/lib/supabase/client'

import { useOrderServiceLines } from '../hooks/use-services'
import {
  addOrderCustomServiceLine,
  addOrderServiceLine,
  removeOrderServiceLine,
  setOrderServiceLine,
  updateOrderCustomServiceLine,
  type OrderServiceLine,
  type ServiceTemplate,
} from '../services/services-service'

export type WorkDraftLine = {
  key: string
  kind: 'part' | 'service'
  serverId: string | null
  itemId: string | null
  templateId: string | null
  name: string
  subtitle: string
  description: string
  quantity: number
  unitPrice: number
  unitName: string
  actorName: string
  createdAt: string
  stockQuantity: number | null
  deleted: boolean
  baseline: {
    name: string
    description: string
    quantity: number
    unitPrice: number
  } | null
}

type OrderWorkCompositionDraftContextValue = {
  orderId: string
  lines: WorkDraftLine[]
  visibleLines: WorkDraftLine[]
  fieldDraft: Record<string, DynamicFieldValueData> | null
  fieldValues: Record<string, DynamicFieldValueData>
  fieldErrors: Record<string, string>
  dirty: boolean
  saving: boolean
  total: number
  addCatalogPart: (item: InventoryItem, actorName: string) => void
  addCatalogService: (template: ServiceTemplate, actorName: string) => void
  addCustomPart: (input: { name: string; unitPrice: number; quantity?: number }, actorName: string) => void
  addCustomService: (
    input: { name: string; description: string; unitPrice: number; quantity?: number },
    actorName: string,
  ) => void
  updateLine: (
    key: string,
    patch: Partial<Pick<WorkDraftLine, 'name' | 'description' | 'quantity' | 'unitPrice' | 'subtitle'>>,
  ) => void
  removeLine: (key: string) => void
  setFieldValue: (
    code: string,
    value: DynamicFieldValueData,
    serverValues: Record<string, DynamicFieldValueData>,
  ) => void
  clearFieldError: (code: string) => void
  bindFields: (fields: DynamicFieldDefinition[], serverValues: Record<string, DynamicFieldValueData>) => void
}

const OrderWorkCompositionDraftContext = createContext<OrderWorkCompositionDraftContextValue | null>(null)

function mapServerLines(
  parts: OrderInventoryUsage[],
  services: OrderServiceLine[],
): WorkDraftLine[] {
  const partLines: WorkDraftLine[] = parts.map((part) => ({
    key: `part:${part.id}`,
    kind: 'part' as const,
    serverId: part.id,
    itemId: part.itemId,
    templateId: null,
    name: part.itemName,
    subtitle: [part.itemCode, part.itemArticle].filter(Boolean).join(' '),
    description: '',
    quantity: part.quantity,
    unitPrice: part.unitPrice,
    unitName: part.unitName || 'шт',
    actorName: part.actorName.trim() || 'Без исполнителя',
    createdAt: part.createdAt,
    stockQuantity: part.stockQuantity,
    deleted: false,
    baseline: {
      name: part.itemName,
      description: '',
      quantity: part.quantity,
      unitPrice: part.unitPrice,
    },
  }))

  const serviceLines: WorkDraftLine[] = services.map((service) => ({
    key: `service:${service.id}`,
    kind: 'service' as const,
    serverId: service.id,
    itemId: null,
    templateId: service.templateId,
    name: service.name,
    subtitle: service.description,
    description: service.description,
    quantity: service.quantity,
    unitPrice: service.unitPrice,
    unitName: 'шт',
    actorName: service.actorName.trim() || 'Без исполнителя',
    createdAt: service.createdAt,
    stockQuantity: null,
    deleted: false,
    baseline: {
      name: service.name,
      description: service.description,
      quantity: service.quantity,
      unitPrice: service.unitPrice,
    },
  }))

  return [...partLines, ...serviceLines].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function newClientKey(kind: 'part' | 'service') {
  return `local:${kind}:${crypto.randomUUID()}`
}

export function OrderWorkCompositionProvider({
  orderId,
  children,
}: {
  orderId: string
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const partsQuery = useOrderInventoryUsage(orderId)
  const servicesQuery = useOrderServiceLines(orderId)
  const [lineDraft, setLineDraft] = useState<WorkDraftLine[] | null>(null)
  const [fieldDraft, setFieldDraft] = useState<Record<string, DynamicFieldValueData> | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [fieldsMeta, setFieldsMeta] = useState<{
    fields: DynamicFieldDefinition[]
    serverValues: Record<string, DynamicFieldValueData>
  } | null>(null)

  const serverParts = partsQuery.data ?? []
  const serverServices = servicesQuery.data ?? []

  const serverLines = useMemo(
    () => mapServerLines(serverParts, serverServices),
    [serverParts, serverServices],
  )

  const lines = lineDraft ?? serverLines
  const visibleLines = useMemo(() => lines.filter((line) => !line.deleted), [lines])
  const fieldValues = fieldDraft ?? fieldsMeta?.serverValues ?? {}
  const linesDirty = lineDraft !== null
  const fieldsDirty = fieldDraft !== null
  const dirty = linesDirty || fieldsDirty
  const total = useMemo(
    () => visibleLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [visibleLines],
  )

  // Если черновик начат до прихода серверных строк — доклеиваем недостающие.
  useEffect(() => {
    if (!lineDraft || serverLines.length === 0) {
      return
    }
    setLineDraft((current) => {
      if (!current) {
        return current
      }
      const known = new Set(current.map((line) => line.serverId).filter(Boolean))
      const missing = serverLines.filter((line) => line.serverId && !known.has(line.serverId))
      if (missing.length === 0) {
        return current
      }
      return [...missing, ...current]
    })
  }, [lineDraft, serverLines])

  const mutateLines = useCallback(
    (updater: (current: WorkDraftLine[]) => WorkDraftLine[]) => {
      setLineDraft((current) => updater(current ?? mapServerLines(serverParts, serverServices)))
    },
    [serverParts, serverServices],
  )

  const addCatalogPart = useCallback(
    (item: InventoryItem, actorName: string) => {
      if (item.stockQuantity < 1) {
        toast.error(`Нет остатка: ${item.name}`)
        return
      }
      mutateLines((current) => {
        const existing = current.find(
          (line) =>
            !line.deleted &&
            line.kind === 'part' &&
            line.itemId === item.id &&
            line.serverId == null,
        )
        if (existing) {
          const nextQty = existing.quantity + 1
          const cap = Math.max(1, Math.round(item.stockQuantity))
          if (nextQty > cap) {
            toast.error(`На складе только ${cap} шт.: ${item.name}`)
            return current
          }
          return current.map((line) =>
            line.key === existing.key ? { ...line, quantity: nextQty } : line,
          )
        }
        const now = new Date().toISOString()
        return [
          ...current,
          {
            key: newClientKey('part'),
            kind: 'part',
            serverId: null,
            itemId: item.id,
            templateId: null,
            name: item.name,
            subtitle: [item.code, item.article].filter(Boolean).join(' '),
            description: '',
            quantity: 1,
            unitPrice: item.repairPrice,
            unitName: item.unitName || 'шт',
            actorName: actorName.trim() || 'Без исполнителя',
            createdAt: now,
            stockQuantity: item.stockQuantity,
            deleted: false,
            baseline: null,
          },
        ]
      })
      toast.success(`Добавлено в состав: ${item.name}`)
    },
    [mutateLines],
  )

  const addCatalogService = useCallback(
    (template: ServiceTemplate, actorName: string) => {
      mutateLines((current) => {
        const existing = current.find(
          (line) =>
            !line.deleted &&
            line.kind === 'service' &&
            line.templateId === template.id &&
            line.serverId == null,
        )
        if (existing) {
          return current.map((line) =>
            line.key === existing.key ? { ...line, quantity: line.quantity + 1 } : line,
          )
        }
        const now = new Date().toISOString()
        return [
          ...current,
          {
            key: newClientKey('service'),
            kind: 'service',
            serverId: null,
            itemId: null,
            templateId: template.id,
            name: template.name,
            subtitle: template.description,
            description: template.description,
            quantity: 1,
            unitPrice: template.unitPrice,
            unitName: 'шт',
            actorName: actorName.trim() || 'Без исполнителя',
            createdAt: now,
            stockQuantity: null,
            deleted: false,
            baseline: null,
          },
        ]
      })
      toast.success(`Добавлено в состав: ${template.name}`)
    },
    [mutateLines],
  )

  const addCustomPart = useCallback(
    (input: { name: string; unitPrice: number; quantity?: number }, actorName: string) => {
      const quantity = input.quantity ?? 1
      const now = new Date().toISOString()
      mutateLines((current) => [
        ...current,
        {
          key: newClientKey('part'),
          kind: 'part',
          serverId: null,
          itemId: null,
          templateId: null,
          name: input.name.trim(),
          subtitle: '',
          description: '',
          quantity,
          unitPrice: input.unitPrice,
          unitName: 'шт',
          actorName: actorName.trim() || 'Без исполнителя',
          createdAt: now,
          stockQuantity: null,
          deleted: false,
          baseline: null,
        },
      ])
      toast.success(`Добавлено в состав: ${input.name.trim()}`)
    },
    [mutateLines],
  )

  const addCustomService = useCallback(
    (
      input: { name: string; description: string; unitPrice: number; quantity?: number },
      actorName: string,
    ) => {
      const quantity = input.quantity ?? 1
      const now = new Date().toISOString()
      mutateLines((current) => [
        ...current,
        {
          key: newClientKey('service'),
          kind: 'service',
          serverId: null,
          itemId: null,
          templateId: null,
          name: input.name.trim(),
          subtitle: input.description.trim(),
          description: input.description.trim(),
          quantity,
          unitPrice: input.unitPrice,
          unitName: 'шт',
          actorName: actorName.trim() || 'Без исполнителя',
          createdAt: now,
          stockQuantity: null,
          deleted: false,
          baseline: null,
        },
      ])
      toast.success(`Добавлено в состав: ${input.name.trim()}`)
    },
    [mutateLines],
  )

  const updateLine = useCallback(
    (
      key: string,
      patch: Partial<Pick<WorkDraftLine, 'name' | 'description' | 'quantity' | 'unitPrice' | 'subtitle'>>,
    ) => {
      mutateLines((current) =>
        current.map((line) => {
          if (line.key !== key) {
            return line
          }
          const next = { ...line, ...patch }
          if (patch.description !== undefined) {
            next.subtitle = patch.description
          }
          return next
        }),
      )
    },
    [mutateLines],
  )

  const removeLine = useCallback(
    (key: string) => {
      mutateLines((current) =>
        current.flatMap((line) => {
          if (line.key !== key) {
            return [line]
          }
          if (!line.serverId) {
            return []
          }
          return [{ ...line, deleted: true }]
        }),
      )
    },
    [mutateLines],
  )

  const setFieldValue = useCallback(
    (code: string, value: DynamicFieldValueData, serverValues: Record<string, DynamicFieldValueData>) => {
      setFieldErrors((current) => {
        if (!current[code]) {
          return current
        }
        const next = { ...current }
        delete next[code]
        return next
      })
      setFieldDraft((current) => ({ ...(current ?? serverValues), [code]: value }))
    },
    [],
  )

  const clearFieldError = useCallback((code: string) => {
    setFieldErrors((current) => {
      if (!current[code]) {
        return current
      }
      const next = { ...current }
      delete next[code]
      return next
    })
  }, [])

  const bindFields = useCallback(
    (fields: DynamicFieldDefinition[], serverValues: Record<string, DynamicFieldValueData>) => {
      setFieldsMeta((current) => {
        if (
          current &&
          current.fields === fields &&
          current.serverValues === serverValues
        ) {
          return current
        }
        return { fields, serverValues }
      })
    },
    [],
  )

  const persist = useCallback(async () => {
    if (!dirty) {
      return
    }

    const fields = fieldsMeta?.fields ?? []
    const serverFieldValues = fieldsMeta?.serverValues ?? {}
    if (fieldsDirty && fields.length > 0) {
      const valuesMerged = { ...serverFieldValues, ...(fieldDraft ?? {}) }
      const filled = filledFieldValues(fields, valuesMerged)
      const parsed = buildEntityValuesSchema(fields).safeParse(filled)
      if (!parsed.success) {
        const nextErrors: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const code = issue.path[0]
          if (typeof code === 'string' && !nextErrors[code]) {
            nextErrors[code] = issue.message
          }
        }
        setFieldErrors(nextErrors)
        toast.error('Заполните обязательные поля состава работ.')
        throw new Error('Заполните обязательные поля состава работ.')
      }
      setFieldErrors({})
    }

    const previousTotal = serverLines
      .filter((line) => !line.deleted)
      .reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
    const nextTotal = visibleLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)

    setSaving(true)
    try {
      const draftLines = lineDraft ?? []
      for (const line of draftLines) {
        if (line.deleted && line.serverId) {
          if (line.kind === 'part') {
            await removeOrderPartLine(line.serverId)
          } else {
            await removeOrderServiceLine(line.serverId)
          }
          continue
        }
        if (line.deleted) {
          continue
        }

        if (!line.serverId) {
          if (line.kind === 'part') {
            if (line.itemId) {
              await consumeInventoryForOrder(orderId, line.itemId, line.quantity, line.unitPrice)
            } else {
              await addOrderCustomPartLine(orderId, {
                name: line.name,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
              })
            }
          } else if (line.templateId) {
            await addOrderServiceLine(orderId, line.templateId, line.quantity, line.unitPrice)
          } else {
            await addOrderCustomServiceLine(orderId, {
              name: line.name,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
            })
          }
          continue
        }

        const baseline = line.baseline
        if (!baseline) {
          continue
        }
        const changed =
          baseline.quantity !== line.quantity ||
          baseline.unitPrice !== line.unitPrice ||
          baseline.name !== line.name ||
          baseline.description !== line.description
        if (!changed) {
          continue
        }

        if (line.kind === 'part') {
          if (line.itemId) {
            await setOrderPartLine(line.serverId, line.quantity, line.unitPrice)
          } else {
            await updateOrderCustomPartLine(line.serverId, {
              name: line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
            })
          }
        } else if (line.templateId) {
          await setOrderServiceLine(line.serverId, line.quantity, line.unitPrice)
        } else {
          await updateOrderCustomServiceLine(line.serverId, {
            name: line.name,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })
        }
      }

      if (fieldsDirty && fields.length > 0 && fieldDraft) {
        const valuesMerged = { ...serverFieldValues, ...fieldDraft }
        const filled = filledFieldValues(fields, valuesMerged)
        const parsed = buildEntityValuesSchema(fields).safeParse(filled)
        if (parsed.success) {
          await saveDynamicFieldValues(FieldEntity.OrderWork, orderId, parsed.data)
          queryClient.setQueryData(queryKeys.fields.values(FieldEntity.OrderWork, orderId), parsed.data)
        }
      }

      if (linesDirty && Math.round(previousTotal * 100) !== Math.round(nextTotal * 100)) {
        const { error: totalError } = await getSupabase().rpc('log_order_total_change', {
          target_order_id: orderId,
          old_total: previousTotal,
          new_total: nextTotal,
        })
        if (totalError) {
          throw totalError
        }
      }

      setLineDraft(null)
      setFieldDraft(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.orderUsage(orderId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.services.orderLines(orderId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fields.values(FieldEntity.OrderWork, orderId),
        }),
      ])
      toast.success('Состав работ сохранён')
    } catch (error) {
      toast.error(getErrorMessage(error))
      throw error
    } finally {
      setSaving(false)
    }
  }, [
    dirty,
    fieldDraft,
    fieldsDirty,
    fieldsMeta,
    lineDraft,
    linesDirty,
    orderId,
    queryClient,
    serverLines,
    visibleLines,
  ])

  const saveFromFooter = useCallback(async () => {
    try {
      await persist()
    } catch {
      // toast already shown
    }
  }, [persist])

  useSheetDirty(dirty, dirty ? () => persist() : undefined)
  useRegisterOrderCardSave('work', {
    dirty,
    saving,
    save: saveFromFooter,
    enabled: true,
  })

  const value = useMemo<OrderWorkCompositionDraftContextValue>(
    () => ({
      orderId,
      lines,
      visibleLines,
      fieldDraft,
      fieldValues,
      fieldErrors,
      dirty,
      saving,
      total,
      addCatalogPart,
      addCatalogService,
      addCustomPart,
      addCustomService,
      updateLine,
      removeLine,
      setFieldValue,
      clearFieldError,
      bindFields,
    }),
    [
      addCatalogPart,
      addCatalogService,
      addCustomPart,
      addCustomService,
      bindFields,
      clearFieldError,
      dirty,
      fieldDraft,
      fieldErrors,
      fieldValues,
      lines,
      orderId,
      removeLine,
      saving,
      setFieldValue,
      total,
      updateLine,
      visibleLines,
    ],
  )

  return (
    <OrderWorkCompositionDraftContext.Provider value={value}>
      {children}
    </OrderWorkCompositionDraftContext.Provider>
  )
}

export function useOrderWorkCompositionDraft() {
  const ctx = useContext(OrderWorkCompositionDraftContext)
  if (!ctx) {
    throw new Error('useOrderWorkCompositionDraft must be used within OrderWorkCompositionProvider')
  }
  return ctx
}

export function useOrderWorkCompositionDraftOptional() {
  return useContext(OrderWorkCompositionDraftContext)
}
