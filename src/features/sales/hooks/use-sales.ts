import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  addSaleLine,
  cancelSale,
  confirmSale,
  createSale,
  deleteSale,
  getSale,
  listSales,
  removeSaleLine,
  setSaleLine,
  updateSale,
} from '../services/sales-service'

export function useSales(search: string, status: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: queryKeys.sales.list({ search, status, page, pageSize }),
    queryFn: () => listSales(search, status, page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useSale(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.sales.detail(id) : queryKeys.sales.all,
    queryFn: () => getSale(id ?? ''),
    enabled: Boolean(id),
  })
}

function invalidateSales(queryClient: ReturnType<typeof useQueryClient>, saleId?: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sales.all }),
    saleId ? queryClient.invalidateQueries({ queryKey: queryKeys.sales.detail(saleId) }) : Promise.resolve(),
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all }),
  ])
}

export function useCreateSale() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input?: {
      customerId?: string | null
      saleDate?: string | null
      invoiceNumber?: string | null
      seedItemId?: string | null
    }) => createSale(input),
    onSuccess: async (saleId) => {
      await invalidateSales(queryClient, saleId)
    },
  })
}

export function useUpdateSale(saleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { customerId: string | null; saleDate: string; invoiceNumber: string }) =>
      updateSale({ saleId, ...input }),
    onSuccess: async () => {
      await invalidateSales(queryClient, saleId)
    },
  })
}

export function useAddSaleLine(saleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { itemId: string; quantity: number; unitPrice: number }) =>
      addSaleLine({ saleId, ...input }),
    onSuccess: async () => {
      await invalidateSales(queryClient, saleId)
    },
  })
}

export function useSetSaleLine(saleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { lineId: string; quantity: number; unitPrice: number }) => setSaleLine(input),
    onSuccess: async () => {
      await invalidateSales(queryClient, saleId)
    },
  })
}

export function useRemoveSaleLine(saleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (lineId: string) => removeSaleLine(lineId),
    onSuccess: async () => {
      await invalidateSales(queryClient, saleId)
    },
  })
}

export function useConfirmSale(saleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => confirmSale(saleId),
    onSuccess: async () => {
      await invalidateSales(queryClient, saleId)
    },
  })
}

export function useCancelSale(saleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => cancelSale(saleId),
    onSuccess: async () => {
      await invalidateSales(queryClient, saleId)
    },
  })
}

export function useDeleteSale() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (saleId: string) => deleteSale(saleId),
    onSuccess: async () => {
      await invalidateSales(queryClient)
    },
  })
}
