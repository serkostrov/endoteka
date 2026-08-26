import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import { listAuditEvents, type AuditListFilters } from '../services/audit-service'

export function useAuditEvents(filters: AuditListFilters) {
  return useQuery({
    queryKey: queryKeys.audit.list(filters),
    queryFn: () => listAuditEvents(filters),
    placeholderData: keepPreviousData,
  })
}
