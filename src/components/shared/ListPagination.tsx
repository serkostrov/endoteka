import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PAGE_SIZE_OPTIONS } from '@/lib/constants/pagination'
import { cn } from '@/lib/utils'

export type ListPaginationProps = {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
  hidePageSize?: boolean
  className?: string
}

export function ListPagination({
  page,
  pageCount,
  onPageChange,
  pageSize,
  onPageSizeChange,
  hidePageSize = false,
  className,
}: ListPaginationProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3',
        hidePageSize ? 'justify-end' : 'justify-between',
        className,
      )}
    >
      {hidePageSize ? null : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">На странице</span>
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger className="h-8 w-[4.75rem]" aria-label="Записей на странице">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {pageCount > 1 ? (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault()
                  onPageChange(Math.max(1, page - 1))
                }}
                aria-disabled={page <= 1}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-3 text-sm text-muted-foreground">
                {page} из {pageCount}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(event) => {
                  event.preventDefault()
                  onPageChange(Math.min(pageCount, page + 1))
                }}
                aria-disabled={page >= pageCount}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  )
}
