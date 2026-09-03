import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  addOrderServiceLine,
  createServiceTemplate,
  deleteServiceTemplate,
  getOrderServiceLines,
  getServiceTemplate,
  removeOrderServiceLine,
  searchServiceTemplates,
  setOrderServiceLine,
  updateServiceTemplate,
  type ServiceTemplateInput,
} from '../services/services-service'

export function useServiceTemplates(search: string, page: number, pageSize: number, activeOnly = false) {
  return useQuery({
    queryKey: queryKeys.services.templates({ search, page, pageSize, activeOnly }),
    queryFn: () => searchServiceTemplates(search, page, pageSize, activeOnly),
    placeholderData: keepPreviousData,
  })
}

export function useOrderServiceLines(orderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.services.orderLines(orderId ?? ''),
    queryFn: () => getOrderServiceLines(orderId ?? ''),
    enabled: Boolean(orderId),
  })
}

export function useServiceTemplate(id: string | null | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.services.template(id) : queryKeys.services.all,
    queryFn: () => getServiceTemplate(id ?? ''),
    enabled: Boolean(id),
  })
}

function invalidateTemplates(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.services.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.orders.all }),
  ])
}

export function useCreateServiceTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ServiceTemplateInput) => createServiceTemplate(input),
    onSuccess: async () => {
      await invalidateTemplates(queryClient)
    },
  })
}

export function useUpdateServiceTemplate(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ServiceTemplateInput) => updateServiceTemplate(id, input),
    onSuccess: async () => {
      await invalidateTemplates(queryClient)
    },
  })
}

export function useDeleteServiceTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteServiceTemplate(id),
    onSuccess: async () => {
      await invalidateTemplates(queryClient)
    },
  })
}

export function useAddOrderServiceLine(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { templateId: string; quantity: number; unitPrice: number }) =>
      addOrderServiceLine(orderId, input.templateId, input.quantity, input.unitPrice),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.services.orderLines(orderId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) })
    },
  })
}

export function useSetOrderServiceLine(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { lineId: string; quantity: number; unitPrice: number }) =>
      setOrderServiceLine(input.lineId, input.quantity, input.unitPrice),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.services.orderLines(orderId) })
    },
  })
}

export function useRemoveOrderServiceLine(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (lineId: string) => removeOrderServiceLine(lineId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.services.orderLines(orderId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) })
    },
  })
}
