import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'

type DetailPlaceholderPageProps = {
  title: string
  description: string
}

export function DetailPlaceholderPage({ title, description }: DetailPlaceholderPageProps) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} />
      <EmptyState
        title="Карточка в разработке"
        description="Навигация и доступ уже работают. Содержимое объекта будет добавлено на следующем этапе."
      />
    </div>
  )
}
