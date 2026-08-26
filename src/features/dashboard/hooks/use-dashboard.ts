import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import { getOperationalDashboard } from '../services/dashboard-service'

export function useOperationalDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: getOperationalDashboard,
    refetchInterval: 60_000,
  })
}
