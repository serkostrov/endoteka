import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/app/App'
import { installVitePreloadErrorHandler } from '@/lib/chunk-load'
import '@/styles/globals.css'

installVitePreloadErrorHandler()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
