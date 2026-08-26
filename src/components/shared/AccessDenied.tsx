import { Link } from 'react-router-dom'

import { ErrorState } from '@/components/shared/ErrorState'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/constants/routes'

export function AccessDenied() {
  return (
    <ErrorState
      title="Недостаточно прав"
      description="Этот раздел недоступен для вашей роли. Если доступ нужен для работы, обратитесь к руководителю."
      action={
        <Button asChild variant="outline">
          <Link to={routes.home}>На главную</Link>
        </Button>
      }
    />
  )
}
