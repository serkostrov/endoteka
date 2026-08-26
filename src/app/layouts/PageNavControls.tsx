import { ArrowLeft, Menu } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { getBackPath } from '@/config/navigation'
import { cn } from '@/lib/utils'

import { useAppChrome } from './app-chrome-context'

type PageNavControlsProps = {
  className?: string
}

export function PageNavControls({ className }: PageNavControlsProps) {
  const location = useLocation()
  const chrome = useAppChrome()
  const backTo = getBackPath(location.pathname)
  const showMenu = Boolean(chrome && !chrome.isTabletUp)

  if (!showMenu && !backTo) {
    return null
  }

  return (
    <div className={cn('flex shrink-0 items-center gap-0.5 print:hidden', className)}>
      {showMenu ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={chrome?.openMobileNav}
          aria-label="Открыть меню"
        >
          <Menu className="size-4" />
        </Button>
      ) : null}
      {backTo ? (
        <Button asChild variant="ghost" size="icon-sm">
          <Link to={backTo} aria-label="Назад">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
