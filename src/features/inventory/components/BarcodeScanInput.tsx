import { useEffect, useId, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { BARCODE_SCAN_IDLE_MS, isScanBarcode } from '@/lib/constants/inventory'
import { cn } from '@/lib/utils'

type BarcodeScanInputProps = {
  onScan: (code: string) => void
  disabled?: boolean
  label?: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

export function BarcodeScanInput({
  onScan,
  disabled = false,
  label = 'Сканер штрихкода',
  placeholder = 'Считайте код сканером или введите и нажмите Enter',
  className,
  autoFocus = false,
}: BarcodeScanInputProps) {
  const id = useId()
  const [value, setValue] = useState('')
  const idleRef = useRef<number>(0)

  useEffect(() => {
    return () => window.clearTimeout(idleRef.current)
  }, [])

  function complete(raw: string) {
    const code = raw.trim()
    if (!code || disabled) {
      return
    }
    window.clearTimeout(idleRef.current)
    onScan(code)
    setValue('')
  }

  return (
    <div className={cn('relative w-full', className)}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <ScanLine className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        inputMode="numeric"
        placeholder={placeholder}
        className="h-9 pl-8"
        onChange={(event) => {
          const next = event.target.value
          setValue(next)
          window.clearTimeout(idleRef.current)
          if (isScanBarcode(next)) {
            idleRef.current = window.setTimeout(() => complete(next), BARCODE_SCAN_IDLE_MS)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            complete(value)
          }
        }}
      />
    </div>
  )
}
