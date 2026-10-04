import { Link } from 'react-router-dom'
import {
  Bell,
  BookOpen,
  ChevronRight,
  ClipboardList,
  FileStack,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/PageHeader'
import { useHasPermission } from '@/features/auth'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'

type SettingsLink = {
  to: string
  title: string
  description: string
  icon: LucideIcon
}

export function SettingsHubScreen() {
  const canEditTemplates = useHasPermission(Permission.DocumentsEditTemplates)

  const links: SettingsLink[] = [
    {
      to: routes.settingsReferences,
      title: 'Параметры',
      description: 'Статусы заказов, справочники и шаблоны услуг',
      icon: BookOpen,
    },
    {
      to: routes.settingsOrders,
      title: 'Маршрут заказов',
      description: 'Нумерация, переходы статусов и контроль сроков',
      icon: ClipboardList,
    },
    {
      to: routes.settingsFields,
      title: 'Поля карточек',
      description: 'Дополнительные поля клиентов, приборов, склада и диагностики',
      icon: SlidersHorizontal,
    },
    ...(canEditTemplates
      ? [
          {
            to: routes.documentTemplates,
            title: 'Шаблоны документов',
            description: 'Макеты печатных форм, актов и этикеток',
            icon: FileStack,
          } satisfies SettingsLink,
        ]
      : []),
    {
      to: routes.settingsNotifications,
      title: 'Уведомления',
      description: 'События, получатели и каналы доставки',
      icon: Bell,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Настройки"
        description="Справочники, маршрут заказов, поля карточек и шаблоны."
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {links.map((item) => (
          <SettingsHubLink key={item.to} {...item} />
        ))}
      </div>
    </div>
  )
}

function SettingsHubLink({ to, title, description, icon: Icon }: SettingsLink) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex items-start gap-3 rounded-xl border bg-card p-3.5 transition-colors',
        'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-none text-foreground">{title}</span>
        <span className="mt-1.5 block text-sm leading-snug text-muted-foreground">{description}</span>
      </span>
      <ChevronRight
        className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden="true"
      />
    </Link>
  )
}
