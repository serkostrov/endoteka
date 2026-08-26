import { Link } from 'react-router-dom'

import { ErrorState } from '@/components/shared/ErrorState'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/constants/routes'

export function NotFoundPage() {
  return (
    <ErrorState
      title="Страница не найдена"
      description="Проверьте адрес или вернитесь на рабочий стол."
      action={
        <Button asChild>
          <Link to={routes.home}>На рабочий стол</Link>
        </Button>
      }
    />
  )
}
