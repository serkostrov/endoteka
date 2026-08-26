import { EmptyState } from '@/components/shared/EmptyState'
import { SectionCard } from '@/components/shared/SectionCard'

type OrderPlaceholderTabProps = {
  title: string
  description: string
}

export function OrderPlaceholderTab({ title, description }: OrderPlaceholderTabProps) {
  return (
    <SectionCard title={title}>
      <EmptyState title="Раздел готовится" description={description} />
    </SectionCard>
  )
}
