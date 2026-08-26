import { cva, type VariantProps } from 'class-variance-authority'
import type { CSSProperties } from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const statusBadgeVariants = cva('border-transparent', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground',
      info: 'bg-info/12 text-info',
      warning: 'bg-warning/12 text-warning',
      danger: 'bg-destructive/12 text-destructive',
      success: 'bg-success/12 text-success',
    },
  },
  defaultVariants: {
    tone: 'neutral',
  },
})

type StatusBadgeProps = VariantProps<typeof statusBadgeVariants> & {
  children: string
  className?: string
  style?: CSSProperties
}

export function StatusBadge({ children, tone, className, style }: StatusBadgeProps) {
  return (
    <Badge
      className={cn(style?.backgroundColor ? 'border-transparent' : statusBadgeVariants({ tone }), className)}
      style={style}
    >
      {children}
    </Badge>
  )
}
