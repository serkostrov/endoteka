import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  INVENTORY_SEARCH_MIN_LENGTH,
  isScanBarcode,
  type InventoryCountLineFilter,
  type InventoryCountSeedMode,
} from '@/lib/constants/inventory'
import { queryKeys } from '@/lib/query-keys'

import {
  addInventoryCountItem,
  cancelInventoryCount,
  completeInventoryCount,
  createInventoryCount,
  getInventoryCount,
  getInventoryCountStatement,
  incrementInventoryCountItem,
  listInventoryCountLines,
  listInventoryCounts,
  removeInventoryCountLine,
  setInventoryCountLineActual,
  startInventoryCount,
} from '../services/counts-service'
import {
  adjustInventory,
  consumeInventoryForOrder,
  createInventoryItem,
  deleteInventoryItem,
  findInventoryItemByName,
  findInventoryItemsByBarcode,
  getInventoryItemCard,
  getInventoryReceipt,
  getOrderInventoryUsage,
  listInventoryAdjustments,
  listInventoryReceipts,
  receiveInventory,
  searchInventoryItems,
  updateInventoryItem,
  type InventoryItemInput,
  type ReceiptLineInput,
} from '../services/inventory-service'

export function useInventoryStock(search: string, page: number, pageSize: number, stockFilter = 'all') {
  return useQuery({
    queryKey: queryKeys.inventory.stock({ search, page, stock: stockFilter }),
    queryFn: () => searchInventoryItems(search, page, pageSize, stockFilter),
    placeholderData: keepPreviousData,
  })
}

export function useInventoryNameMatches(name: string, excludeId?: string) {
  const term = name.trim()

  return useQuery({
    queryKey: [...queryKeys.inventory.name(term), excludeId ?? ''] as const,
    queryFn: () => findInventoryItemByName(term, excludeId),
    enabled: term.length >= INVENTORY_SEARCH_MIN_LENGTH,
    staleTime: 30_000,
  })
}

export function useInventoryBarcodeLookup(barcode: string) {
  const term = barcode.trim()

  return useQuery({
    queryKey: queryKeys.inventory.barcode(term),
    queryFn: () => findInventoryItemsByBarcode(term),
    enabled: isScanBarcode(term) || term.length >= INVENTORY_SEARCH_MIN_LENGTH,
    staleTime: 15_000,
  })
}

export function useInventoryItemCard(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.inventory.item(id) : queryKeys.inventory.all,
    queryFn: () => getInventoryItemCard(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useInventoryReceipts(page: number, pageSize: number) {
  return useQuery({
    queryKey: queryKeys.inventory.receipts(page),
    queryFn: () => listInventoryReceipts(page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useInventoryReceipt(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.inventory.receipt(id) : queryKeys.inventory.all,
    queryFn: () => getInventoryReceipt(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useInventoryAdjustments(page: number, pageSize: number) {
  return useQuery({
    queryKey: queryKeys.inventory.adjustments(page),
    queryFn: () => listInventoryAdjustments(page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useOrderInventoryUsage(orderId: string | undefined) {
  return useQuery({
    queryKey: orderId ? queryKeys.inventory.orderUsage(orderId) : queryKeys.inventory.all,
    queryFn: () => getOrderInventoryUsage(orderId ?? ''),
    enabled: Boolean(orderId),
  })
}

function invalidateInventory(queryClient: ReturnType<typeof useQueryClient>, itemId?: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all }),
    itemId ? queryClient.invalidateQueries({ queryKey: queryKeys.inventory.item(itemId) }) : Promise.resolve(),
    queryClient.invalidateQueries({ queryKey: queryKeys.orders.all }),
  ])
}

export function useCreateInventoryItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: InventoryItemInput) => createInventoryItem(input),
    onSuccess: async () => {
      await invalidateInventory(queryClient)
    },
  })
}

export function useUpdateInventoryItem(itemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: InventoryItemInput) => updateInventoryItem(itemId, input),
    onSuccess: async () => {
      await invalidateInventory(queryClient, itemId)
    },
  })
}

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (itemId: string) => deleteInventoryItem(itemId),
    onSuccess: async () => {
      await invalidateInventory(queryClient)
    },
  })
}

export function useReceiveInventory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      supplier: string
      receiptDate: string
      notes: string
      lines: ReceiptLineInput[]
    }) => receiveInventory(input),
    onSuccess: async () => {
      await invalidateInventory(queryClient)
    },
  })
}

export function useConsumeInventoryForOrder(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { itemId: string; quantity: number }) =>
      consumeInventoryForOrder(orderId, input.itemId, input.quantity),
    onSuccess: async () => {
      await invalidateInventory(queryClient)
      await queryClient.invalidateQueries({ queryKey: queryKeys.inventory.orderUsage(orderId) })
    },
  })
}

export function useAdjustInventory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: adjustInventory,
    onSuccess: async (_data, variables) => {
      await invalidateInventory(queryClient, variables.itemId)
    },
  })
}

export function useInventoryCounts(status: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: queryKeys.inventory.counts({ status, page }),
    queryFn: () => listInventoryCounts(status, page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useInventoryCount(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.inventory.count(id) : queryKeys.inventory.all,
    queryFn: () => getInventoryCount(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useInventoryCountLines(
  countId: string | undefined,
  search: string,
  filter: InventoryCountLineFilter,
  page: number,
  pageSize: number,
) {
  return useQuery({
    queryKey: countId
      ? queryKeys.inventory.countLines(countId, { search, filter, page })
      : queryKeys.inventory.all,
    queryFn: () => listInventoryCountLines(countId ?? '', search, filter, page, pageSize),
    enabled: Boolean(countId),
    placeholderData: keepPreviousData,
  })
}

export function useInventoryCountStatement(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.inventory.countStatement(id) : queryKeys.inventory.all,
    queryFn: () => getInventoryCountStatement(id ?? ''),
    enabled: Boolean(id),
  })
}

function invalidateCounts(queryClient: ReturnType<typeof useQueryClient>, countId?: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all }),
    countId ? queryClient.invalidateQueries({ queryKey: queryKeys.inventory.count(countId) }) : Promise.resolve(),
  ])
}

export function useCreateInventoryCount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { seedMode: InventoryCountSeedMode; seedItemId?: string | null }) =>
      createInventoryCount(input),
    onSuccess: async () => {
      await invalidateCounts(queryClient)
    },
  })
}

export function useStartInventoryCount(countId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => startInventoryCount(countId),
    onSuccess: async () => {
      await invalidateCounts(queryClient, countId)
    },
  })
}

export function useCancelInventoryCount(countId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => cancelInventoryCount(countId),
    onSuccess: async () => {
      await invalidateCounts(queryClient, countId)
    },
  })
}

export function useCompleteInventoryCount(countId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => completeInventoryCount(countId),
    onSuccess: async () => {
      await invalidateInventory(queryClient)
      await invalidateCounts(queryClient, countId)
    },
  })
}

export function useAddInventoryCountItem(countId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (itemId: string) => addInventoryCountItem(countId, itemId),
    onSuccess: async () => {
      await invalidateCounts(queryClient, countId)
    },
  })
}

export function useRemoveInventoryCountLine(countId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (lineId: string) => removeInventoryCountLine(lineId),
    onSuccess: async () => {
      await invalidateCounts(queryClient, countId)
    },
  })
}

export function useSetInventoryCountLineActual(countId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { lineId: string; actual: number }) =>
      setInventoryCountLineActual(input.lineId, input.actual),
    onSuccess: async () => {
      await invalidateCounts(queryClient, countId)
    },
  })
}

export function useIncrementInventoryCountItem(countId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (itemId: string) => incrementInventoryCountItem(countId, itemId),
    onSuccess: async () => {
      await invalidateCounts(queryClient, countId)
    },
  })
}
