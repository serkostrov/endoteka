import { cn } from '@/lib/utils'

/** Подсветка активного фильтра — как primary-кнопка («Новый заказ»). */
export const activeFilterControlClassName =
  'border-primary bg-primary text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground data-[placeholder]:text-primary-foreground/80 [&_svg:not([class*=text-])]:text-primary-foreground!'

export function activeFilterControlClass(active: boolean, className?: string) {
  return cn(className, active && activeFilterControlClassName)
}
