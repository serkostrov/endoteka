import { Link } from 'react-router-dom'

import { routes } from '@/lib/constants/routes'

type SupplierLinkProps = {
  name: string
  customerId?: string | null
  className?: string
}

export function SupplierLink({ name, customerId, className }: SupplierLinkProps) {
  const label = name.trim() || '—'

  if (!customerId) {
    return <span className={className}>{label}</span>
  }

  return (
    <Link
      to={routes.customer.replace(':id', customerId)}
      className={className ?? 'text-primary underline-offset-2 hover:underline'}
      onClick={(event) => event.stopPropagation()}
    >
      {label}
    </Link>
  )
}
