import { Link } from 'react-router-dom'
import type { UseFormReturn } from 'react-hook-form'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useReferenceItemsBySetCode } from '@/features/references'
import { INVENTORY_SEARCH_DEBOUNCE_MS, isAllowedInventoryUnitCode } from '@/lib/constants/inventory'
import { ReferenceSetCode } from '@/lib/constants/references'
import { routes } from '@/lib/constants/routes'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { useInventoryNameMatches } from '../hooks/use-inventory'
import type { InventoryItemFormValues } from '../schemas'

type ItemFieldsProps = {
  form: UseFormReturn<InventoryItemFormValues>
  disabled?: boolean
  excludeItemId?: string
}

export function ItemFields({ form, disabled = false, excludeItemId }: ItemFieldsProps) {
  const name = form.watch('name')
  const debouncedName = useDebouncedValue(name.trim(), INVENTORY_SEARCH_DEBOUNCE_MS)
  const matchesQuery = useInventoryNameMatches(disabled ? '' : debouncedName, excludeItemId)
  const matches = matchesQuery.data ?? []
  const categories = useReferenceItemsBySetCode(ReferenceSetCode.InventoryCategories)
  const units = useReferenceItemsBySetCode(ReferenceSetCode.UnitsOfMeasure)
  const unitOptions = (units.data ?? []).filter((item) => item.isActive && isAllowedInventoryUnitCode(item.code))
  const categoryOptions = (categories.data ?? []).filter((item) => item.isActive)

  return (
    <div className="space-y-4">
      {matches.length > 0 ? (
        <Alert>
          <AlertTitle>Такое наименование уже в справочнике</AlertTitle>
          <AlertDescription>
            <ul className="space-y-1">
              {matches.map((item) => (
                <li key={item.id}>
                  <Button asChild variant="link" className="h-auto px-0">
                    <Link to={routes.inventoryItem.replace(':id', item.id)}>
                      Открыть {item.name}
                      {item.code ? ` (${item.code})` : ''}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Наименование</FormLabel>
            <FormControl>
              <Input {...field} autoComplete="off" disabled={disabled} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Код</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" disabled={disabled} placeholder="Назначится сам" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="article"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Артикул</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="barcode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Штрихкод</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" inputMode="numeric" disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="categoryId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Категория</FormLabel>
              <Select value={field.value} disabled={disabled} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full" aria-label="Категория">
                    <SelectValue placeholder="Выберите категорию" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {categoryOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="unitId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Единица</FormLabel>
              <Select value={field.value} disabled={disabled} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full" aria-label="Единица измерения">
                    <SelectValue placeholder="шт или упак" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {unitOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <PriceField form={form} name="purchasePrice" label="Закупка" disabled={disabled} />
        <PriceField form={form} name="repairPrice" label="Ремонт" disabled={disabled} />
        <PriceField form={form} name="retailPrice" label="Розница" disabled={disabled} />
      </div>
    </div>
  )
}

function PriceField({
  form,
  name,
  label,
  disabled,
}: {
  form: UseFormReturn<InventoryItemFormValues>
  name: 'purchasePrice' | 'repairPrice' | 'retailPrice'
  label: string
  disabled: boolean
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={0}
              step="0.01"
              disabled={disabled}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value === '' ? 0 : Number(event.target.value))}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
