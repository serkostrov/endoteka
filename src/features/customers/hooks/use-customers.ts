import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'
import type { CustomerKind } from '@/lib/constants/customers'

import {
  createCustomer,
  deleteCustomer,
  findCustomersByInn,
  getCustomerCard,
  listCustomers,
  searchCustomers,
  updateCustomer,
  type CustomerInput,
} from '../services/customers-service'

export function useCustomers(search: string, page: number, pageSize: number, kind?: CustomerKind) {
  return useQuery({
    queryKey: queryKeys.customers.list({ search, page, kind }),
    queryFn: () => listCustomers(search, page, pageSize, kind),
    placeholderData: keepPreviousData,
  })
}

export function useCustomerSearch(query: string, page: number, pageSize: number, enabled = true) {
  const term = query.trim()

  return useQuery({
    queryKey: queryKeys.customers.search({ query: term, page }),
    queryFn: () => searchCustomers(term, page, pageSize),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function useCustomerInnMatches(inn: string, excludeId?: string) {
  const term = inn.trim()

  return useQuery({
    queryKey: [...queryKeys.customers.inn(term), excludeId ?? ''] as const,
    queryFn: () => findCustomersByInn(term, excludeId),
    enabled: term.length >= 10,
    staleTime: 30_000,
  })
}

export function useCustomerCard(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.customers.detail(id) : queryKeys.customers.all,
    queryFn: () => getCustomerCard(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useCreateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CustomerInput) => createCustomer(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers.all })
    },
  })
}

export function useUpdateCustomer(customerId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CustomerInput) => updateCustomer(customerId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId) })
    },
  })
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (customerId: string) => deleteCustomer(customerId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers.all })
    },
  })
}
