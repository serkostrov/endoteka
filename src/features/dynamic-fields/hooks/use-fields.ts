import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  getDynamicFieldUsage,
  listDynamicFields,
  listFieldEntities,
  listFieldTypes,
  listDynamicFieldValues,
  reorderDynamicFields,
  setDynamicFieldActive,
  setDynamicFieldLayout,
  upsertDynamicField,
  deleteDynamicField,
  type DynamicFieldDefinition,
  type DynamicFieldInput,
} from '../services/fields-service'

export function useFieldTypes() {
  return useQuery({
    queryKey: queryKeys.fields.types,
    queryFn: listFieldTypes,
  })
}

export function useFieldEntities() {
  return useQuery({
    queryKey: queryKeys.fields.entities,
    queryFn: listFieldEntities,
  })
}

export function useDynamicFields(entityCode: string | undefined) {
  return useQuery({
    queryKey: entityCode ? queryKeys.fields.byEntity(entityCode) : queryKeys.fields.all,
    queryFn: () => listDynamicFields(entityCode ?? ''),
    enabled: Boolean(entityCode),
  })
}

export function useDynamicFieldValues(entityCode: string | undefined, recordId: string | undefined) {
  return useQuery({
    queryKey:
      entityCode && recordId ? queryKeys.fields.values(entityCode, recordId) : queryKeys.fields.all,
    queryFn: () => listDynamicFieldValues(entityCode ?? '', recordId ?? ''),
    enabled: Boolean(entityCode && recordId),
  })
}

export function useDynamicFieldUsage(fieldId: string | undefined) {
  return useQuery({
    queryKey: fieldId ? queryKeys.fields.usage(fieldId) : queryKeys.fields.all,
    queryFn: () => getDynamicFieldUsage(fieldId ?? ''),
    enabled: Boolean(fieldId),
  })
}

export function useUpsertDynamicField(entityCode: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: DynamicFieldInput) => upsertDynamicField(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.byEntity(entityCode) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.entities })
    },
  })
}

export function useSetDynamicFieldLayout(entityCode: string) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.fields.byEntity(entityCode)

  return useMutation({
    mutationFn: ({
      fieldId,
      layoutWidth,
      layoutHeight,
    }: {
      fieldId: string
      layoutWidth: DynamicFieldDefinition['layoutWidth']
      layoutHeight: DynamicFieldDefinition['layoutHeight']
    }) => setDynamicFieldLayout(fieldId, layoutWidth, layoutHeight),
    onMutate: async ({ fieldId, layoutWidth, layoutHeight }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<DynamicFieldDefinition[]>(queryKey)
      queryClient.setQueryData<DynamicFieldDefinition[]>(queryKey, (current) =>
        current?.map((field) =>
          field.id === fieldId ? { ...field, layoutWidth, layoutHeight } : field,
        ),
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey })
    },
  })
}

export function useSetDynamicFieldActive(entityCode: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ fieldId, isActive }: { fieldId: string; isActive: boolean }) =>
      setDynamicFieldActive(fieldId, isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.byEntity(entityCode) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.entities })
    },
  })
}

export function useReorderDynamicFields(entityCode: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fieldIds: string[]) => reorderDynamicFields(entityCode, fieldIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.byEntity(entityCode) })
    },
  })
}

export function useDeleteDynamicField(entityCode: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fieldId: string) => deleteDynamicField(fieldId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.byEntity(entityCode) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.entities })
    },
  })
}
