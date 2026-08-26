import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import { listActiveEmployees, listUsers, type UserListFilters } from '../services/users-service'

export function useUsers(filters: UserListFilters) {
  return useQuery({
    queryKey: queryKeys.users.list(filters),
    queryFn: () => listUsers(filters),
    placeholderData: keepPreviousData,
  })
}

export function useActiveEmployees() {
  return useQuery({
    queryKey: queryKeys.employees.active,
    queryFn: listActiveEmployees,
  })
}
