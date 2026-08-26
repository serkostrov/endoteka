import { Navigate } from 'react-router-dom'

import { routes } from '@/lib/constants/routes'

export function OrderNewPage() {
  return <Navigate to={`${routes.orders}?new=1`} replace />
}
