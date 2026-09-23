import { ImageIcon } from 'lucide-react'

import { ImageHoverPreview } from '@/components/shared/ImageLightbox'
import { cn } from '@/lib/utils'

type InventoryItemCoverThumbProps = {
  src: string | null | undefined
  alt: string
  className?: string
}

/** Миниатюра обложки в списках склада/номенклатуры; при наведении — крупный превью. */
export function InventoryItemCoverThumb({ src, alt, className }: InventoryItemCoverThumbProps) {
  const boxClass = cn(
    'shrink-0 overflow-hidden rounded-md border bg-muted',
    !className?.includes('size-') && 'size-10',
    className,
  )

  if (!src) {
    return (
      <div className={cn(boxClass, 'flex items-center justify-center text-muted-foreground')} aria-hidden>
        <ImageIcon className="size-3.5 opacity-40" />
      </div>
    )
  }

  return (
    <ImageHoverPreview src={src} alt={alt} className={boxClass}>
      <span
        className="block size-full"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <img src={src} alt="" draggable={false} className="size-full object-cover" />
      </span>
    </ImageHoverPreview>
  )
}
