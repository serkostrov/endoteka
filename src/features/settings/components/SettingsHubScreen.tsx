import { Link } from 'react-router-dom'
import { BookOpen, Bell, ClipboardList, FileStack, SlidersHorizontal } from 'lucide-react'

import { PageHeader } from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'

export function SettingsHubScreen() {
  const canEditTemplates = useHasPermission(Permission.DocumentsEditTemplates)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Настройки"
        description="Справочники, шаблоны документов, маршрут заказов и дополнительные поля карточек. Менять состав может только сотрудник с правом изменения настроек."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard
          title="Параметры"
          description="Статусы заказов, бренды, модели, шаблоны услуг, единицы измерения и другие словари."
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={routes.settingsReferences}>Открыть</Link>
            </Button>
          }
        >
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <BookOpen className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>Статусы заказов, справочники, шаблоны услуг и значения для форм. Колонки доски берутся из статусов.</p>
          </div>
        </SectionCard>

        <SectionCard
          title="Маршрут заказов"
          description="Нумерация, допустимые переходы статусов и проверка сроков."
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={routes.settingsOrders}>Открыть</Link>
            </Button>
          }
        >
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>Цепочка статусов настраивается отдельно. Смена статуса в заказе идёт только по разрешённым переходам.</p>
          </div>
        </SectionCard>

        <SectionCard
          title="Поля карточек"
          description="Дополнительные поля клиентов, приборов, диагностики и других разделов."
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={routes.settingsFields}>Открыть</Link>
            </Button>
          }
        >
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <SlidersHorizontal className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>Типы: текст, число и список. Поля можно скрыть, не удаляя уже введённые данные.</p>
          </div>
        </SectionCard>

        {canEditTemplates ? (
          <SectionCard
            title="Шаблоны документов"
            description="Печатные формы, акты и этикетки. Макет правится в редакторе."
            actions={
              <Button asChild variant="outline" size="sm">
                <Link to={routes.documentTemplates}>Открыть</Link>
              </Button>
            }
          >
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <FileStack className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>Документы по заказу создаются во вкладке заказа. Здесь настраиваются только шаблоны.</p>
            </div>
          </SectionCard>
        ) : null}

        <SectionCard
          title="Уведомления"
          description="События, получатели и каналы: приложение, email, Telegram."
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={routes.settingsNotifications}>Открыть</Link>
            </Button>
          }
        >
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>Письма и Telegram уходят отдельно от заказа. Секреты SMTP и бота в функции, не в этой форме.</p>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
