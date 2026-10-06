import { useEffect } from 'react'

import { useCompanyLogo } from '@/features/settings/hooks/use-company-logo'

const DEFAULT_ICON = '/favicon.svg'

export function CompanyLogoFavicon() {
  const logoQuery = useCompanyLogo()
  const logoUrl = logoQuery.data ?? null

  useEffect(() => {
    const href = logoUrl || DEFAULT_ICON
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.append(link)
    }
    link.href = href
    if (logoUrl) {
      link.removeAttribute('type')
    } else {
      link.type = 'image/svg+xml'
    }

    let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    if (!apple) {
      apple = document.createElement('link')
      apple.rel = 'apple-touch-icon'
      document.head.append(apple)
    }
    apple.href = href
  }, [logoUrl])

  return null
}
