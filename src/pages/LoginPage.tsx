import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { LoginForm } from '@/features/auth'

export function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Вход в систему</CardTitle>
        <CardDescription>Используйте рабочую учётную запись сервисного центра.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  )
}
