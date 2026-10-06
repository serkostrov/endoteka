import { Camera, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useHasPermission } from '@/features/auth'
import { APP_NAME } from '@/lib/constants/app'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { pickImageFiles } from '@/lib/pick-image-files'
import { cn } from '@/lib/utils'

import {
  useCompanyLogo,
  useRemoveCompanyLogo,
  useUploadCompanyLogo,
} from '../hooks/use-company-logo'
import { COMPANY_LOGO_ACCEPT } from '../services/company-logo-service'

type BrandMarkSize = 'sm' | 'md' | 'lg'

const MARK_SIZE: Record<BrandMarkSize, string> = {
  sm: 'size-8 text-sm',
  md: 'size-10 text-base',
  lg: 'size-12 text-lg',
}

type AppBrandMarkProps = {
  size?: BrandMarkSize
  className?: string
}

export function AppBrandMark({ size = 'sm', className }: AppBrandMarkProps) {
  const logoQuery = useCompanyLogo()
  const logoUrl = logoQuery.data ?? null

  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary font-semibold text-primary-foreground',
        MARK_SIZE[size],
        className,
      )}
    >
      {logoUrl ? (
        <img src={logoUrl} alt={APP_NAME} className="size-full bg-card object-contain" />
      ) : (
        <span aria-hidden="true">Э</span>
      )}
    </span>
  )
}

type AppBrandLogoProps = {
  collapsed?: boolean
  className?: string
}

export function AppBrandLogo({ collapsed = false, className }: AppBrandLogoProps) {
  const canEdit = useHasPermission(Permission.SettingsUpdate)
  const logoQuery = useCompanyLogo()
  const upload = useUploadCompanyLogo()
  const remove = useRemoveCompanyLogo()
  const [menuOpen, setMenuOpen] = useState(false)
  const pending = upload.isPending || remove.isPending
  const logoUrl = logoQuery.data ?? null

  async function handleUpload() {
    if (pending || !canEdit) {
      return
    }
    const files = await pickImageFiles({ accept: COMPANY_LOGO_ACCEPT })
    const file = files[0]
    if (!file) {
      return
    }
    try {
      await upload.mutateAsync(file)
      toast.success('Логотип обновлён')
      setMenuOpen(false)
    } catch (error) {
      const message = getErrorMessage(error)
      if (/function|bucket|does not exist|PGRST|schema cache/i.test(message)) {
        toast.error('Логотип не настроен в базе. Примените миграцию company_logo.')
      } else if (/row-level security|policy|403|unauthorized|jwt|Недостаточно прав/i.test(message)) {
        toast.error('Нет права менять логотип. Нужно право «Настройки: изменение».')
      } else {
        toast.error(message)
      }
    }
  }

  async function handleRemove() {
    if (pending || !canEdit || !logoUrl) {
      return
    }
    try {
      await remove.mutateAsync()
      toast.success('Логотип удалён')
      setMenuOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const mark = (
    <span className="relative shrink-0">
      <AppBrandMark
        className={
          canEdit
            ? 'ring-offset-sidebar group-hover:ring-2 group-hover:ring-primary/40 group-focus-visible:ring-2 group-focus-visible:ring-ring'
            : undefined
        }
      />
      {canEdit ? (
        <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/45 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {pending ? (
            <Loader2 className="size-3.5 animate-spin text-white" />
          ) : (
            <Camera className="size-3.5 text-white" />
          )}
        </span>
      ) : null}
    </span>
  )

  const titleBlock = collapsed ? null : (
    <div className="min-w-0 flex-1 text-left">
      <p className="truncate text-sm font-semibold">{APP_NAME}</p>
      <p className="truncate text-[11px] text-sidebar-foreground/55">Сервисный центр</p>
    </div>
  )

  if (!canEdit) {
    return (
      <div className={cn('flex min-w-0 items-center gap-2', className)}>
        {mark}
        {titleBlock}
      </div>
    )
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className={cn(
            'group flex min-w-0 flex-1 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          aria-label={logoUrl ? 'Изменить логотип' : 'Загрузить изображение'}
        >
          {mark}
          {titleBlock}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault()
            void handleUpload()
          }}
        >
          {logoUrl ? 'Изменить логотип' : 'Загрузить изображение'}
        </DropdownMenuItem>
        {logoUrl ? (
          <DropdownMenuItem
            variant="destructive"
            disabled={pending}
            onSelect={(event) => {
              event.preventDefault()
              void handleRemove()
            }}
          >
            <Trash2 className="size-4" />
            Удалить логотип
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
