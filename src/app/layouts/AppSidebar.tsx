import { ChevronUp, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { flattenNavItems, isNavItemActive, type NavGroup, type NavItem } from '@/config/navigation'
import { AccountSwitcherItems } from '@/features/auth/components/AccountSwitcher'
import { ProfileAvatarEditor } from '@/features/auth/components/ProfileAvatarEditor'
import { useAuth, useHasPermission } from '@/features/auth'
import { signOut } from '@/features/auth/services/auth-service'
import { NotificationsButton } from '@/features/notifications'
import { APP_NAME } from '@/lib/constants/app'
import { Permission } from '@/lib/constants/permissions'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getInitials } from '@/lib/utils/initials'

type AppSidebarProps = {
  groups: NavGroup[]
  collapsed: boolean
  onNavigate?: () => void
  onToggleCollapsed?: () => void
}

export function AppSidebar({ groups, collapsed, onNavigate, onToggleCollapsed }: AppSidebarProps) {
  const { user } = useAuth()
  const location = useLocation()
  const items = flattenNavItems(groups)
  const displayName = user?.fullName || user?.email || 'Пользователь'
  const initials = getInitials(displayName)
  const canReadNotifications = useHasPermission(Permission.NotificationsRead)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function handleSignOut() {
    setSignOutError(null)
    setIsSigningOut(true)

    try {
      await signOut()
    } catch (error) {
      setSignOutError(getErrorMessage(error))
      setIsSigningOut(false)
    }
  }

  const collapseLabel = collapsed ? 'Развернуть меню' : 'Свернуть меню'
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  const collapseButton = onToggleCollapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={onToggleCollapsed}
          aria-label={collapseLabel}
        >
          <CollapseIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{collapseLabel}</TooltipContent>
    </Tooltip>
  ) : null

  return (
    <div
      className={cn(
        'flex h-full flex-col bg-sidebar text-sidebar-foreground',
        collapsed ? 'w-full' : 'w-max max-w-full',
      )}
    >
      <div
        className={cn(
          'flex border-b border-sidebar-border',
          collapsed ? 'flex-col items-center gap-1 px-1.5 py-2' : 'h-12 items-center gap-2 px-2',
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
          Э
        </span>
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{APP_NAME}</p>
            <p className="truncate text-[11px] text-sidebar-foreground/55">Сервисный центр</p>
          </div>
        )}
        {collapseButton}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <nav
          aria-label="Основная навигация"
          className={cn('w-max max-w-full space-y-4 py-3', collapsed ? 'px-2' : 'px-2')}
        >
          {groups.map((group) => (
            <div key={group.id}>
              {collapsed ? (
                <span className="sr-only">{group.label}</span>
              ) : (
                <p className="mb-1 px-2 text-[11px] font-medium tracking-wide whitespace-nowrap text-sidebar-foreground/45 uppercase">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <SidebarLink
                      item={item}
                      collapsed={collapsed}
                      isActive={isNavItemActive(location.pathname, item, items)}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div
        className={cn(
          'border-t border-sidebar-border',
          collapsed ? 'flex flex-col items-center gap-1 p-1.5' : 'flex items-center gap-1 p-2',
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {collapsed ? (
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent"
                aria-label={displayName}
              >
                <Avatar size="sm">
                  {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </button>
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-sidebar-accent"
              >
                <Avatar size="sm">
                  {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{displayName}</span>
                  {user?.email ? (
                    <span className="block truncate text-[11px] text-sidebar-foreground/55">{user.email}</span>
                  ) : null}
                </span>
                <ChevronUp className="size-3.5 shrink-0 text-sidebar-foreground/55" />
              </button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side={collapsed ? 'right' : 'top'} align={collapsed ? 'end' : 'start'} className="w-80 p-1.5">
            <div className="flex items-center gap-3 p-2">
              <ProfileAvatarEditor />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user?.fullName || 'Пользователь'}</p>
                <p className="text-muted-foreground truncate text-xs">{user?.email}</p>
                <p className="text-primary mt-0.5 text-[11px]">Сейчас в системе</p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">Нажмите на фото, чтобы заменить</p>
              </div>
            </div>
            <DropdownMenuSeparator className="my-1.5" />
            <AccountSwitcherItems />
            <DropdownMenuSeparator className="my-1.5" />
            {signOutError ? <p className="text-destructive px-2 py-1.5 text-xs">{signOutError}</p> : null}
            <DropdownMenuItem
              disabled={isSigningOut}
              className="rounded-md"
              onSelect={(event) => {
                event.preventDefault()
                void handleSignOut()
              }}
            >
              <LogOut className="size-4" />
              {isSigningOut ? 'Выход…' : 'Выйти'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {canReadNotifications ? (
          <NotificationsButton
            side={collapsed ? 'right' : 'top'}
            align="end"
            className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          />
        ) : null}
      </div>
    </div>
  )
}

function SidebarLink({
  item,
  collapsed,
  isActive,
  onNavigate,
}: {
  item: NavItem
  collapsed: boolean
  isActive: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  const count = item.badgeCount ?? 0
  const link = (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center rounded-md text-sm transition-colors',
        collapsed ? 'relative justify-center p-2' : 'gap-2 px-2 py-1.5 whitespace-nowrap',
        isActive
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/70',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="whitespace-nowrap">{item.label}</span>}
      {count > 0 && collapsed ? (
        <span className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium text-primary-foreground">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
      {count > 0 && !collapsed ? (
        <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-medium text-primary-foreground">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </NavLink>
  )

  if (!collapsed) {
    return link
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {count > 0 ? `${item.label} (${count > 99 ? '99+' : count})` : item.label}
      </TooltipContent>
    </Tooltip>
  )
}
