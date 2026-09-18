import { EntitySheetLink } from '@/components/shared/EntitySheetLink'

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
    <EntitySheetLink kind="customer" id={customerId} className={className}>
      {label}
    </EntitySheetLink>
  )
}
