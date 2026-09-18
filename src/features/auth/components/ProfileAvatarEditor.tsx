import { Camera, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getErrorMessage } from '@/lib/errors'
import { pickImageFiles } from '@/lib/pick-image-files'
import { getInitials } from '@/lib/utils/initials'
import { cn } from '@/lib/utils'

import { useAuth } from '../hooks/use-auth'
import {
  PROFILE_AVATAR_ACCEPT,
  removeMyAvatar,
  uploadMyAvatar,
} from '../services/auth-service'

type ProfileAvatarEditorProps = {
  className?: string
  size?: 'default' | 'lg'
}

export function ProfileAvatarEditor({ className, size = 'lg' }: ProfileAvatarEditorProps) {
  const { user, refreshUser } = useAuth()
  const [pending, setPending] = useState(false)
  const initials = getInitials(user?.fullName || user?.email || 'Пользователь')

  async function handlePick() {
    if (pending) {
      return
    }
    const files = await pickImageFiles({ accept: PROFILE_AVATAR_ACCEPT })
    const file = files[0]
    if (!file) {
      return
    }
    setPending(true)
    try {
      await uploadMyAvatar(file)
      await refreshUser()
      toast.success('Фото профиля обновлено')
    } catch (error) {
      const message = getErrorMessage(error)
      if (/function|bucket|does not exist|PGRST|schema cache/i.test(message)) {
        toast.error('Аватары не настроены в базе. Примените миграцию profile_avatars / fix_photo_uploads.')
      } else if (/row-level security|policy|403|unauthorized|jwt/i.test(message)) {
        toast.error('Нет доступа к хранилищу аватаров. Проверьте политики storage.')
      } else {
        toast.error(message)
      }
    } finally {
      setPending(false)
    }
  }

  async function handleRemove() {
    if (!user?.avatarUrl || pending) {
      return
    }
    setPending(true)
    try {
      await removeMyAvatar()
      await refreshUser()
      toast.success('Фото профиля удалено')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={cn('relative shrink-0', className)}>
      <button
        type="button"
        disabled={pending}
        className="group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Изменить фото профиля"
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void handlePick()
        }}
      >
        <Avatar size={size} className={size === 'lg' ? 'size-10' : undefined}>
          {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {pending ? (
            <Loader2 className="size-4 animate-spin text-white" />
          ) : (
            <Camera className="size-4 text-white" />
          )}
        </span>
      </button>
      {user?.avatarUrl ? (
        <button
          type="button"
          disabled={pending}
          className="bg-background text-muted-foreground hover:text-destructive absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border shadow-sm"
          aria-label="Удалить фото"
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void handleRemove()
          }}
        >
          <Trash2 className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
