import type { ComponentProps, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type IconActionButtonProps = {
  label: string
  children: ReactNode
} & Omit<ComponentProps<typeof Button>, 'children'>

export function IconActionButton({
  label,
  children,
  variant = 'outline',
  size = 'icon-sm',
  disabled = false,
  className,
  ...props
}: IconActionButtonProps) {
  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      aria-label={label}
      className={className}
      {...props}
    >
      {children}
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex">{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
