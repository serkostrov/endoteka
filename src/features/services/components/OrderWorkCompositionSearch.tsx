import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { SearchCreateAction, SearchSuggestOverlay } from '@/components/shared/SearchSuggestOverlay'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CreateItemDialog } from '@/features/inventory/components/CreateItemDialog'
import {
  useConsumeInventoryForOrder,
  useInventoryBarcodeLookup,
  useInventoryStock,
} from '@/features/inventory/hooks/use-inventory'
import {
  findInventoryItemsByBarcode,
  type InventoryItem,
} from '@/features/inventory/services/inventory-service'
import { useHasPermission } from '@/features/auth'
import { useOrder, useUpdateOrder } from '@/features/orders/hooks/use-orders'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  BARCODE_SCAN_IDLE_MS,
  INVENTORY_PICKER_PAGE_SIZE,
  INVENTORY_SEARCH_DEBOUNCE_MS,
  formatMoney,
  formatQuantity,
  isScanBarcode,
} from '@/lib/constants/inventory'
import { Permission } from '@/lib/constants/permissions'
import { SERVICE_PICKER_PAGE_SIZE, SERVICE_SEARCH_DEBOUNCE_MS } from '@/lib/constants/services'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { CreateServiceTemplateDialog } from './CreateServiceTemplateDialog'
import { useAddOrderServiceLine, useServiceTemplates } from '../hooks/use-services'
import type { ServiceTemplate } from '../services/services-service'

type SuggestItem =
  | { kind: 'service'; id: string; template: ServiceTemplate }
  | { kind: 'product'; id: string; item: InventoryItem }

type ProductCategoryGroup = {
  id: string
  name: string
  items: InventoryItem[]
}

const MASTER_NONE = '__none__'
const DEBOUNCE_MS = Math.max(INVENTORY_SEARCH_DEBOUNCE_MS, SERVICE_SEARCH_DEBOUNCE_MS)
const FOLDER_SERVICES = 'services'
const FOLDER_PRODUCTS = 'products'

export function OrderWorkCompositionSearch({ orderId }: { orderId: string }) {
  const inputId = useId()
  const canWriteOff = useHasPermission(Permission.InventoryWriteOff)
  const canCreateItem = useHasPermission(Permission.InventoryReceive)
  const canUpdateOrder = useHasPermission(Permission.OrdersUpdate)
  const orderQuery = useOrder(orderId)
  const updateOrder = useUpdateOrder(orderId)
  const employees = useActiveEmployees()
  const consume = useConsumeInventoryForOrder(orderId)
  const addService = useAddOrderServiceLine(orderId)

  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    [FOLDER_PRODUCTS]: true,
    [FOLDER_SERVICES]: false,
  })
  const [createServiceOpen, setCreateServiceOpen] = useState(false)
  const [createItemOpen, setCreateItemOpen] = useState(false)
  const [createQuery, setCreateQuery] = useState('')
  const addInFlight = useRef(false)
  const idleRef = useRef(0)

  const debouncedSearch = useDebouncedValue(search, DEBOUNCE_MS)
  const term = debouncedSearch.trim()

  const servicesQuery = useServiceTemplates(debouncedSearch, 1, SERVICE_PICKER_PAGE_SIZE, true)
  const productsQuery = useInventoryStock(debouncedSearch, 1, INVENTORY_PICKER_PAGE_SIZE)
  const barcodeQuery = useInventoryBarcodeLookup(debouncedSearch)

  const order = orderQuery.data
  const masterId = order?.responsibleId ?? MASTER_NONE
  const masterName =
    employees.data?.find((employee) => employee.id === order?.responsibleId)?.fullName ||
    order?.responsibleName ||
    ''

  const barcodeHits = barcodeQuery.data ?? []
  const productItems =
    canWriteOff && term && barcodeHits.length > 0
      ? barcodeHits
      : canWriteOff
        ? (productsQuery.data?.items ?? [])
        : []
  const serviceItems = canUpdateOrder ? (servicesQuery.data?.items ?? []) : []

  const productGroups = useMemo(() => groupProductsByCategory(productItems), [productItems])

  const flatSuggestions = useMemo(() => {
    const rows: SuggestItem[] = []
    const productsOpen = Boolean(expanded[FOLDER_PRODUCTS]) || Boolean(term)
    const servicesOpen = Boolean(expanded[FOLDER_SERVICES]) || Boolean(term)

    if (productsOpen) {
      for (const group of productGroups) {
        const groupOpen = Boolean(expanded[group.id]) || Boolean(term)
        if (!groupOpen) {
          continue
        }
        for (const item of group.items) {
          rows.push({ kind: 'product', id: `product:${item.id}`, item })
        }
      }
    }
    if (servicesOpen) {
      for (const template of serviceItems) {
        rows.push({ kind: 'service', id: `service:${template.id}`, template })
      }
    }
    return rows
  }, [expanded, productGroups, serviceItems, term])

  const searching =
    (canUpdateOrder && servicesQuery.isFetching) ||
    (canWriteOff && (productsQuery.isFetching || (term.length > 0 && barcodeQuery.isFetching)))

  useEffect(() => {
    setActiveIndex(0)
  }, [flatSuggestions])

  useEffect(() => {
    if (!term) {
      return
    }
    setExpanded((current) => {
      const next: Record<string, boolean> = {
        ...current,
        [FOLDER_SERVICES]: true,
        [FOLDER_PRODUCTS]: true,
      }
      for (const group of productGroups) {
        next[group.id] = true
      }
      return next
    })
  }, [term, productGroups])

  useEffect(() => {
    return () => window.clearTimeout(idleRef.current)
  }, [])

  function initials(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      return '?'
    }
    if (parts.length === 1) {
      return parts[0]!.slice(0, 2).toUpperCase()
    }
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
  }

  function toggleFolder(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }))
  }

  async function addProduct(item: InventoryItem) {
    if (addInFlight.current || !canWriteOff) {
      return
    }
    addInFlight.current = true
    try {
      await consume.mutateAsync({
        itemId: item.id,
        quantity: 1,
        unitPrice: item.repairPrice,
      })
      toast.success(`Добавлено: ${item.name}`)
      setSearch('')
      setOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      addInFlight.current = false
    }
  }

  async function addServiceTemplate(template: ServiceTemplate) {
    if (addInFlight.current || !canUpdateOrder) {
      return
    }
    addInFlight.current = true
    try {
      await addService.mutateAsync({
        templateId: template.id,
        quantity: 1,
        unitPrice: template.unitPrice,
      })
      toast.success(`Добавлено: ${template.name}`)
      setSearch('')
      setOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      addInFlight.current = false
    }
  }

  async function choose(row: SuggestItem) {
    if (row.kind === 'service') {
      await addServiceTemplate(row.template)
      return
    }
    await addProduct(row.item)
  }

  async function handleScan(code: string) {
    if (!canWriteOff) {
      return
    }
    try {
      const items = await findInventoryItemsByBarcode(code)
      const match = items[0]
      if (items.length === 1 && match) {
        await addProduct(match)
        return
      }
      if (items.length === 0) {
        toast.error('Позиция со штрихкодом не найдена')
        return
      }
      setSearch(code)
      setExpanded((current) => ({ ...current, [FOLDER_PRODUCTS]: true }))
      setOpen(true)
      toast.message('Найдено несколько позиций. Выберите нужную.')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  function openCreateService() {
    setCreateQuery(search.trim())
    setCreateServiceOpen(true)
    setOpen(false)
  }

  function openCreateProduct() {
    setCreateQuery(search.trim())
    setCreateItemOpen(true)
    setOpen(false)
  }

  function setMaster(next: string) {
    if (!canUpdateOrder) {
      return
    }
    updateOrder.mutate(
      {
        orderId,
        responsibleId: next === MASTER_NONE ? null : next,
        changeResponsible: true,
      },
      { onError: (error) => toast.error(getErrorMessage(error)) },
    )
  }

  const busy = consume.isPending || addService.isPending
  const showPanel = open && !busy
  const servicesOpen = Boolean(expanded[FOLDER_SERVICES]) || Boolean(term)
  const productsOpen = Boolean(expanded[FOLDER_PRODUCTS]) || Boolean(term)

  return (
    <>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(11rem,14rem)] md:items-end">
        <div className="space-y-1">
          <Label htmlFor={inputId} className="text-[11px] font-medium text-muted-foreground">
            Работа, услуга или товар
          </Label>
          <SearchSuggestOverlay
            open={showPanel}
            onOpenChange={setOpen}
            contentClassName="w-[min(40rem,calc(100vw-2rem))] max-h-[min(22rem,var(--radix-popover-content-available-height))]"
            panel={
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                  {searching && flatSuggestions.length === 0 && !serviceItems.length && !productItems.length ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">Поиск…</p>
                  ) : (
                    <div className="space-y-0.5">
                      {canWriteOff ? (
                        <FolderBlock
                          title="Товары"
                          count={productItems.length}
                          open={productsOpen}
                          onToggle={() => toggleFolder(FOLDER_PRODUCTS)}
                        >
                          {productGroups.length === 0 ? (
                            <p className="px-3 py-2 pl-9 text-xs text-muted-foreground">
                              {term ? 'Товары не найдены' : 'Пока нет товаров'}
                            </p>
                          ) : (
                            productGroups.map((group) => {
                              const groupOpen = Boolean(expanded[group.id]) || Boolean(term)
                              return (
                                <FolderBlock
                                  key={group.id}
                                  title={group.name}
                                  count={group.items.length}
                                  open={groupOpen}
                                  nested
                                  onToggle={() => toggleFolder(group.id)}
                                >
                                  {group.items.map((item) => {
                                    const id = `product:${item.id}`
                                    const index = flatSuggestions.findIndex((row) => row.id === id)
                                    const meta = [item.code, item.article].filter(Boolean).join(' · ')
                                    const stock = `ост. ${formatQuantity(item.stockQuantity)} ${item.unitName || 'шт'}`
                                    return (
                                      <SuggestRow
                                        key={id}
                                        active={index === activeIndex}
                                        indent={2}
                                        title={item.name}
                                        subtitle={[meta, stock].filter(Boolean).join(' · ')}
                                        price={item.repairPrice}
                                        disabled={busy}
                                        onHover={() => {
                                          if (index >= 0) {
                                            setActiveIndex(index)
                                          }
                                        }}
                                        onSelect={() => void addProduct(item)}
                                      />
                                    )
                                  })}
                                </FolderBlock>
                              )
                            })
                          )}
                        </FolderBlock>
                      ) : null}

                      {canUpdateOrder ? (
                        <FolderBlock
                          title="Услуги"
                          count={serviceItems.length}
                          open={servicesOpen}
                          onToggle={() => toggleFolder(FOLDER_SERVICES)}
                        >
                          {serviceItems.length === 0 ? (
                            <p className="px-3 py-2 pl-9 text-xs text-muted-foreground">
                              {term ? 'Услуги не найдены' : 'Пока нет услуг'}
                            </p>
                          ) : (
                            serviceItems.map((template) => {
                              const id = `service:${template.id}`
                              const index = flatSuggestions.findIndex((row) => row.id === id)
                              return (
                                <SuggestRow
                                  key={id}
                                  active={index === activeIndex}
                                  indent={1}
                                  title={template.name}
                                  subtitle={template.description || undefined}
                                  price={template.unitPrice}
                                  disabled={busy}
                                  onHover={() => {
                                    if (index >= 0) {
                                      setActiveIndex(index)
                                    }
                                  }}
                                  onSelect={() => void addServiceTemplate(template)}
                                />
                              )
                            })
                          )}
                        </FolderBlock>
                      ) : null}

                      {!canUpdateOrder && !canWriteOff ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">Нет прав на изменение состава.</p>
                      ) : null}
                    </div>
                  )}
                </div>

                {(canUpdateOrder || canCreateItem) && (
                  <div className="shrink-0">
                    {canCreateItem ? (
                      <SearchCreateAction label="Новый товар" onCreate={openCreateProduct} />
                    ) : null}
                    {canUpdateOrder ? (
                      <SearchCreateAction label="Новая услуга" onCreate={openCreateService} />
                    ) : null}
                  </div>
                )}
              </div>
            }
          >
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={inputId}
                value={search}
                disabled={busy}
                autoComplete="off"
                placeholder="Наименование, штрихкод, код, артикул"
                className="h-9 pr-16 pl-8 text-sm"
                onChange={(event) => {
                  const next = event.target.value
                  setSearch(next)
                  setOpen(true)
                  window.clearTimeout(idleRef.current)
                  if (canWriteOff && isScanBarcode(next)) {
                    idleRef.current = window.setTimeout(() => void handleScan(next), BARCODE_SCAN_IDLE_MS)
                  }
                }}
                onClick={() => setOpen(true)}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setOpen(false)
                    return
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setOpen(true)
                    setActiveIndex((current) =>
                      Math.min(current + 1, Math.max(flatSuggestions.length - 1, 0)),
                    )
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setActiveIndex((current) => Math.max(current - 1, 0))
                    return
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const row = flatSuggestions[activeIndex]
                    if (row) {
                      void choose(row)
                    }
                  }
                }}
              />
              <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5">
                {search ? (
                  <button
                    type="button"
                    aria-label="Очистить"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSearch('')
                      setOpen(true)
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={open ? 'Скрыть список' : 'Показать список'}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setOpen((current) => !current)}
                >
                  <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
                </button>
              </div>
            </div>
          </SearchSuggestOverlay>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] font-medium text-muted-foreground">Мастер</Label>
          <Select
            value={masterId || MASTER_NONE}
            onValueChange={setMaster}
            disabled={!canUpdateOrder || updateOrder.isPending || orderQuery.isLoading}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Не назначен">
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar size="sm">
                    <AvatarFallback>{initials(masterName || '—')}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{masterName || 'Не назначен'}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MASTER_NONE}>Не назначен</SelectItem>
              {(employees.data ?? []).map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  <span className="flex items-center gap-2">
                    <Avatar size="sm">
                      <AvatarFallback>{initials(employee.fullName)}</AvatarFallback>
                    </Avatar>
                    {employee.fullName}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <CreateServiceTemplateDialog
        open={createServiceOpen}
        onOpenChange={setCreateServiceOpen}
        initialQuery={createQuery}
        orderId={orderId}
        onCreatedForOrder={() => {
          setCreateServiceOpen(false)
        }}
        onCreated={(item) => void addServiceTemplate(item)}
      />
      <CreateItemDialog
        open={createItemOpen}
        onOpenChange={setCreateItemOpen}
        initialQuery={createQuery}
        orderId={orderId}
        onCreatedForOrder={() => {
          setCreateItemOpen(false)
        }}
        onCreated={(item) => void addProduct(item)}
      />
    </>
  )
}

function FolderBlock({
  title,
  count,
  open,
  nested = false,
  onToggle,
  children,
}: {
  title: string
  count: number
  open: boolean
  nested?: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const Icon = open ? FolderOpen : Folder
  return (
    <div>
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-1.5 py-1.5 text-left text-sm font-medium hover:bg-accent/60',
          nested ? 'pl-7 pr-3' : 'px-3',
        )}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{title}</span>
        <span className="ml-auto text-[11px] font-normal tabular-nums text-muted-foreground">{count}</span>
      </button>
      {open ? <div>{children}</div> : null}
    </div>
  )
}

function SuggestRow({
  title,
  subtitle,
  price,
  active,
  indent,
  disabled,
  onHover,
  onSelect,
}: {
  title: string
  subtitle?: string
  price: number
  active: boolean
  indent: 1 | 2
  disabled?: boolean
  onHover: () => void
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm',
        indent === 1 ? 'pl-9' : 'pl-14',
        active ? 'bg-accent' : 'hover:bg-accent/70',
      )}
      onMouseEnter={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium leading-5">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[11px] leading-4 text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatMoney(price)} ₽</span>
    </button>
  )
}

function groupProductsByCategory(items: InventoryItem[]): ProductCategoryGroup[] {
  const map = new Map<string, ProductCategoryGroup>()
  for (const item of items) {
    const name = item.categoryName.trim() || 'Без категории'
    const id = `category:${item.categoryId || name}`
    const group = map.get(id) ?? { id, name, items: [] }
    group.items.push(item)
    map.set(id, group)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}
