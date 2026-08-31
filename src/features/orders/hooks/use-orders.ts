import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  addOrderAttachmentUrl,
  changeOrderStatus,
  createOrder,
  deleteOrder,
  deleteOrderAttachment,
  getAvailableOrderTransitions,
  getOrder,
  getOrderAppSettings,
  listOrderAttachments,
  listOrders,
  listTransitionRuleTypes,
  listWorkflowTransitions,
  previewNextOrderNumber,
  processOrderDeadlines,
  setOrderNumberStart,
  updateOrder,
  uploadOrderFile,
  upsertOrderTransition,
  deleteOrderTransition,
  listOrderStatusCatalog,
  listOrderStatusGroups,
  upsertOrderStatus,
  deleteOrderStatus,
  upsertOrderStatusGroup,
  deleteOrderStatusGroup,
  reorderOrderStatusGroups,
  reorderOrderStatuses,
  type CreateOrderInput,
  type OrderListFilters,
  type UpdateOrderInput,
} from '../services/orders-service'

export function useOrders(filters: OrderListFilters, enabled = true) {
  return useQuery({
    queryKey: queryKeys.orders.list(filters),
    queryFn: () => listOrders(filters),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.orders.detail(id) : queryKeys.orders.all,
    queryFn: () => getOrder(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useOrderTransitions(orderId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: orderId ? queryKeys.orders.transitions(orderId) : queryKeys.orders.all,
    queryFn: () => getAvailableOrderTransitions(orderId ?? ''),
    enabled: Boolean(orderId) && enabled,
  })
}

export function useOrderAttachments(orderId: string | undefined) {
  return useQuery({
    queryKey: orderId ? queryKeys.orders.attachments(orderId) : queryKeys.orders.all,
    queryFn: () => listOrderAttachments(orderId ?? ''),
    enabled: Boolean(orderId),
  })
}

export function usePreviewOrderNumber(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orders.previewNumber,
    queryFn: previewNextOrderNumber,
    enabled,
  })
}

export function useOrderAppSettings() {
  return useQuery({
    queryKey: queryKeys.orders.settings,
    queryFn: getOrderAppSettings,
  })
}

export function useWorkflowTransitions() {
  return useQuery({
    queryKey: queryKeys.orders.workflow,
    queryFn: listWorkflowTransitions,
  })
}

export function useTransitionRuleTypes() {
  return useQuery({
    queryKey: [...queryKeys.orders.workflow, 'rules'] as const,
    queryFn: listTransitionRuleTypes,
  })
}

async function invalidateOrder(queryClient: ReturnType<typeof useQueryClient>, orderId?: string) {
  await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
  await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
  await queryClient.invalidateQueries({ queryKey: queryKeys.devices.all })
  if (orderId) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.orders.transitions(orderId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.orders.diagnostics(orderId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.orders.attachments(orderId) })
  }
}

export function useCreateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateOrderInput) => createOrder(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
    },
  })
}

export function useDeleteOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: string) => deleteOrder(orderId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
    },
  })
}

export function useUpdateOrder(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateOrderInput) => updateOrder(input),
    onSuccess: async () => {
      await invalidateOrder(queryClient, orderId)
    },
  })
}

export function useChangeOrderStatus(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { statusId: string; warranty?: { start: string; end: string } | null }) =>
      changeOrderStatus(orderId, input.statusId, input.warranty),
    onSuccess: async () => {
      await invalidateOrder(queryClient, orderId)
    },
  })
}

export function useMoveOrderStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      orderId: string
      statusId: string
      warranty?: { start: string; end: string } | null
    }) => changeOrderStatus(input.orderId, input.statusId, input.warranty),
    onSuccess: async (_data, input) => {
      await invalidateOrder(queryClient, input.orderId)
    },
  })
}

export function useAddOrderAttachmentUrl(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ url, caption }: { url: string; caption: string }) =>
      addOrderAttachmentUrl(orderId, url, caption),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.attachments(orderId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) })
    },
  })
}

export function useUploadOrderFile(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ file, caption }: { file: File; caption: string }) =>
      uploadOrderFile(orderId, file, caption),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.attachments(orderId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) })
    },
  })
}

export function useDeleteOrderAttachment(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, filePath }: { id: string; filePath: string | null }) =>
      deleteOrderAttachment(id, filePath),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.attachments(orderId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) })
    },
  })
}

export function useSetOrderNumberStart() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (nextStart: number) => setOrderNumberStart(nextStart),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.settings })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.previewNumber })
    },
  })
}

export function useProcessOrderDeadlines() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: processOrderDeadlines,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
    },
  })
}

export function useUpsertOrderTransition() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: upsertOrderTransition,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.workflow })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
    },
  })
}

export function useDeleteOrderTransition() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteOrderTransition,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.workflow })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
    },
  })
}

function invalidateStatusCatalog(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.orders.statusCatalog }),
    queryClient.invalidateQueries({ queryKey: queryKeys.orders.statusGroups }),
    queryClient.invalidateQueries({ queryKey: queryKeys.orders.workflow }),
    queryClient.invalidateQueries({ queryKey: queryKeys.orders.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.references.all }),
  ])
}

export function useOrderStatusCatalog() {
  return useQuery({
    queryKey: queryKeys.orders.statusCatalog,
    queryFn: listOrderStatusCatalog,
  })
}

export function useOrderStatusGroups() {
  return useQuery({
    queryKey: queryKeys.orders.statusGroups,
    queryFn: listOrderStatusGroups,
  })
}

export function useUpsertOrderStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: upsertOrderStatus,
    onSuccess: async () => {
      await invalidateStatusCatalog(queryClient)
    },
  })
}

export function useDeleteOrderStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteOrderStatus,
    onSuccess: async () => {
      await invalidateStatusCatalog(queryClient)
    },
  })
}

export function useUpsertOrderStatusGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: upsertOrderStatusGroup,
    onSuccess: async () => {
      await invalidateStatusCatalog(queryClient)
    },
  })
}

export function useDeleteOrderStatusGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteOrderStatusGroup,
    onSuccess: async () => {
      await invalidateStatusCatalog(queryClient)
    },
  })
}

export function useReorderOrderStatusGroups() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reorderOrderStatusGroups,
    onSuccess: async () => {
      await invalidateStatusCatalog(queryClient)
    },
  })
}

export function useReorderOrderStatuses() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reorderOrderStatuses,
    onSuccess: async () => {
      await invalidateStatusCatalog(queryClient)
    },
  })
}
