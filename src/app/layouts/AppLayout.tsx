import { Suspense, useEffect, useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { LoadingState } from '@/components/shared/LoadingState'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { filterNavGroups, navGroups, type NavGroup } from '@/config/navigation'
import { useAuth } from '@/features/auth'
import { hasPermission } from '@/features/auth/permissions'
import { useOpenTaskCount } from '@/features/tasks/hooks/use-tasks'
import { useMediaQuery } from '@/hooks/use-media-query'
import { APP_NAME } from '@/lib/constants/app'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'

import { AppChromeProvider } from './app-chrome-context'
import { AppSidebar } from './AppSidebar'

const SIDEBAR_STORAGE_KEY = 'endoteka.sidebar-collapsed'

export function AppLayout() {
  const { user } = useAuth()
  const isTabletUp = useMediaQuery('(min-width: 768px)')
  const canReadTasks = hasPermission(user, Permission.TasksRead)
  const openTaskCount = useOpenTaskCount(canReadTasks)
  const [collapsed, setCollapsed] = useState(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (stored !== null) {
      return stored === 'true'
    }
    return !window.matchMedia('(min-width: 1024px)').matches
  })
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  const groups = withOpenTaskBadge(
    filterNavGroups(navGroups, (permission) => hasPermission(user, permission)),
    openTaskCount.data ?? 0,
  )

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed))
  }, [collapsed])

  const sidebarCollapsed = isTabletUp && collapsed
  const chromeValue = useMemo(
    () => ({
      isTabletUp,
      openMobileNav: () => setIsMobileNavOpen(true),
    }),
    [isTabletUp],
  )

  return (
    <AppChromeProvider value={chromeValue}>
      <div className="flex min-h-screen bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 print:hidden"
        >
          Перейти к содержимому
        </a>

        {isTabletUp ? (
          <aside
            className={
              sidebarCollapsed
                ? 'sticky top-0 h-screen w-16 shrink-0 border-r border-sidebar-border print:hidden'
                : 'sticky top-0 h-screen w-60 shrink-0 border-r border-sidebar-border print:hidden'
            }
          >
            <AppSidebar
              groups={groups}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={() => setCollapsed((value) => !value)}
            />
          </aside>
        ) : (
          <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{APP_NAME}</SheetTitle>
                <SheetDescription>Навигация по разделам</SheetDescription>
              </SheetHeader>
              <AppSidebar groups={groups} collapsed={false} onNavigate={() => setIsMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main-content" className="flex-1 p-3 md:p-4 print:p-0">
            <Suspense fallback={<LoadingState />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </AppChromeProvider>
  )
}

function withOpenTaskBadge(groups: NavGroup[], count: number): NavGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => (item.to === routes.tasks ? { ...item, badgeCount: count } : item)),
  }))
}
