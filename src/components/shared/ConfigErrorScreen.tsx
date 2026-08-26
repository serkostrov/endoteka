import { APP_NAME } from '@/lib/constants/app'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function ConfigErrorScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg space-y-6">
        <div>
          <p className="text-sm font-medium text-primary">{APP_NAME}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Приложение не настроено</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Для запуска задайте публичные переменные клиента Supabase в окружении
            (локально — файл <code className="text-xs">.env</code>, на сервере — переменные Dokploy).
          </p>
        </div>
        <Alert>
          <AlertTitle>Нужные переменные</AlertTitle>
          <AlertDescription>
            <code className="mt-2 block text-xs">VITE_SUPABASE_URL</code>
            <code className="block text-xs">VITE_SUPABASE_ANON_KEY</code>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}
