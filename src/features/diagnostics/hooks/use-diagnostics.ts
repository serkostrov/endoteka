import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { FieldEntity } from '@/lib/constants/fields'
import { queryKeys } from '@/lib/query-keys'

import {
  addOrderJournalNote,
  getOrderDiagnostics,
  getOrderJournal,
  saveOrderDiagnostics,
  type SaveDiagnosticsInput,
} from '../services/diagnostics-service'

export function useOrderDiagnostics(orderId: string | undefined) {
  return useQuery({
    queryKey: orderId ? queryKeys.orders.diagnostics(orderId) : queryKeys.orders.all,
    queryFn: () => getOrderDiagnostics(orderId ?? ''),
    enabled: Boolean(orderId),
  })
}

export function useOrderJournal(orderId: string | undefined) {
  return useQuery({
    queryKey: orderId ? queryKeys.orders.history(orderId) : queryKeys.orders.all,
    queryFn: () => getOrderJournal(orderId ?? ''),
    enabled: Boolean(orderId),
  })
}

export function useAddOrderJournalNote(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: string) => addOrderJournalNote(orderId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) })
    },
  })
}

export function useSaveOrderDiagnostics(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Omit<SaveDiagnosticsInput, 'orderId'>) =>
      saveOrderDiagnostics({ ...input, orderId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.diagnostics(orderId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.transitions(orderId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.fields.values(FieldEntity.Diagnostics, orderId) })
    },
  })
}
