import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { getInitials } from '@/lib/utils/initials'
import { cn } from '@/lib/utils'

import { removeSavedAccount, type SavedAccount } from '../account-locker'
import { useAuth, useSavedAccounts } from '../hooks/use-auth'
import { addAnotherAccount, switchAccount } from '../services/auth-service'

type AccountSwitcherProps = {
  onDone?: () => void
}

export function AccountSwitcherItems({ onDone }: AccountSwitcherProps) {
  const { user } = useAuth()
  const accounts = useSavedAccounts()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const others = accounts.filter((account) => account.userId !== user?.id)

  async function handleSwitch(account: SavedAccount) {
    if (account.userId === user?.id || pendingId) {
      return
    }

    setPendingId(account.userId)
    try {
      await switchAccount(account.userId)
      queryClient.clear()
      toast.success(`Вы вошли как ${account.fullName || account.email}`)
      onDone?.()
      navigate(routes.home, { replace: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPendingId(null)
    }
  }

  async function handleAdd() {
    setPendingId('add')
    try {
      await addAnotherAccount()
      queryClient.clear()
      onDone?.()
      navigate(routes.login, { replace: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="px-1.5 pb-1">
      {others.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground px-1.5 pt-1 text-[11px] font-medium tracking-wide uppercase">
            Переключить
          </p>
          {others.map((account) => (
            <AccountRow
              key={account.userId}
              account={account}
              busy={pendingId === account.userId}
              disabled={Boolean(pendingId)}
              onSelect={() => void handleSwitch(account)}
              onForget={() => removeSavedAccount(account.userId)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={Boolean(pendingId)}
        className="text-muted-foreground hover:bg-accent hover:text-foreground mt-1 flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left text-sm"
        onClick={() => void handleAdd()}
      >
        <span className="bg-muted flex size-8 items-center justify-center rounded-full">
          {pendingId === 'add' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </span>
        <span>
          <span className="text-foreground block font-medium">Добавить учётную запись</span>
          <span className="block text-xs">Войти ещё одним сотрудником</span>
        </span>
      </button>
    </div>
  )
}

function AccountRow({
  account,
  busy,
  disabled,
  current = false,
  onSelect,
  onForget,
}: {
  account: SavedAccount
  busy: boolean
  disabled: boolean
  current?: boolean
  onSelect: () => void
  onForget?: () => void
}) {
  const title = account.fullName || account.email

  return (
    <div className="group/account relative">
      <button
        type="button"
        disabled={disabled || current}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left text-sm transition-colors',
          current ? 'bg-accent' : 'hover:bg-accent',
          busy && 'opacity-70',
        )}
        onClick={onSelect}
      >
        <Avatar size="sm" className="size-8">
          <AvatarFallback className="text-xs">{getInitials(title)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{title}</span>
            {current ? <Check className="text-primary size-3.5 shrink-0" /> : null}
          </span>
          <span className="text-muted-foreground block truncate text-xs">{account.email}</span>
        </span>
        {busy ? <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" /> : null}
      </button>
      {onForget && !current ? (
        <button
          type="button"
          className="text-muted-foreground hover:bg-background hover:text-destructive absolute top-1/2 right-1.5 hidden size-7 -translate-y-1/2 items-center justify-center rounded-md group-hover/account:flex"
          aria-label={`Убрать ${title} из списка`}
          onClick={(event) => {
            event.stopPropagation()
            onForget()
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function SavedAccountsOnLogin() {
  const accounts = useSavedAccounts()
  const queryClient = useQueryClient()
  const [pendingId, setPendingId] = useState<string | null>(null)

  if (accounts.length === 0) {
    return null
  }

  async function handleSwitch(account: SavedAccount) {
    setPendingId(account.userId)
    try {
      await switchAccount(account.userId)
      queryClient.clear()
      toast.success(`Вы вошли как ${account.fullName || account.email}`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="mb-5 space-y-2">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">Продолжить как</p>
      <ul className="space-y-1.5">
        {accounts.map((account) => {
          const title = account.fullName || account.email
          return (
            <li key={account.userId} className="group/account relative">
              <button
                type="button"
                disabled={Boolean(pendingId)}
                className="hover:bg-accent flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm"
                onClick={() => void handleSwitch(account)}
              >
                <Avatar className="size-9">
                  <AvatarFallback>{getInitials(title)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{title}</span>
                  <span className="text-muted-foreground block truncate text-xs">{account.email}</span>
                </span>
                {pendingId === account.userId ? (
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                ) : null}
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:bg-background hover:text-destructive absolute top-1/2 right-2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-md group-hover/account:flex"
                aria-label={`Убрать ${title} из списка`}
                onClick={() => removeSavedAccount(account.userId)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
