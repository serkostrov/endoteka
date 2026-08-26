import { createContext, useContext, type ReactNode } from 'react'

type AppChromeContextValue = {
  isTabletUp: boolean
  openMobileNav: () => void
}

const AppChromeContext = createContext<AppChromeContextValue | null>(null)

export function AppChromeProvider({
  value,
  children,
}: {
  value: AppChromeContextValue
  children: ReactNode
}) {
  return <AppChromeContext.Provider value={value}>{children}</AppChromeContext.Provider>
}

export function useAppChrome() {
  return useContext(AppChromeContext)
}
