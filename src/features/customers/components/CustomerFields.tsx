import { Link } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CUSTOMER_SEARCH_DEBOUNCE_MS, CustomerKind, customerKindLabels } from '@/lib/constants/customers'
import { routes } from '@/lib/constants/routes'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { UseFormReturn } from 'react-hook-form'

import { useCustomerInnMatches } from '../hooks/use-customers'
import { nameLabel, type CustomerFormValues } from '../schemas'

type CustomerFieldsProps = {
  form: UseFormReturn<CustomerFormValues>
  disabled?: boolean
  excludeCustomerId?: string
}

export function CustomerFields({ form, disabled = false, excludeCustomerId }: CustomerFieldsProps) {
  const kind = form.watch('kind')
  const inn = form.watch('inn')
  const isOrg = kind === CustomerKind.Organization
  const debouncedInn = useDebouncedValue(inn.trim(), CUSTOMER_SEARCH_DEBOUNCE_MS)
  const matchesQuery = useCustomerInnMatches(disabled ? '' : debouncedInn, excludeCustomerId)
  const matches = matchesQuery.data ?? []

  return (
    <div className="space-y-4">
      {matches.length > 0 ? (
        <Alert>
          <AlertTitle>Похожий ИНН уже есть</AlertTitle>
          <AlertDescription>
            <p className="mb-2">Это не запрещает сохранить запись. Проверьте, что это не тот же клиент.</p>
            <ul className="space-y-1">
              {matches.map((item) => (
                <li key={item.id}>
                  <Button asChild variant="link" className="h-auto px-0">
                    <Link to={routes.customer.replace(':id', item.id)}>Открыть {item.name}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <FormField
        control={form.control}
        name="kind"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Тип</FormLabel>
            <Select
              value={field.value}
              disabled={disabled}
              onValueChange={(next) => {
                field.onChange(next)
                if (next === CustomerKind.Individual) {
                  form.setValue('kpp', '')
                }
              }}
            >
              <FormControl>
                <SelectTrigger className="w-full" aria-label="Тип клиента">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={CustomerKind.Organization}>{customerKindLabels.organization}</SelectItem>
                <SelectItem value={CustomerKind.Individual}>{customerKindLabels.individual}</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{nameLabel(kind)}</FormLabel>
            <FormControl>
              <Input
                {...field}
                disabled={disabled}
                autoComplete={isOrg ? 'organization' : 'name'}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="contactName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{isOrg ? 'Контактное лицо' : 'Доп. контакт'}</FormLabel>
              <FormControl>
                <Input {...field} disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Город</FormLabel>
              <FormControl>
                <Input {...field} disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Телефон</FormLabel>
              <FormControl>
                <Input {...field} disabled={disabled} inputMode="tel" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} disabled={disabled} type="email" autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="inn"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ИНН</FormLabel>
              <FormControl>
                <Input {...field} disabled={disabled} inputMode="numeric" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {isOrg ? (
          <FormField
            control={form.control}
            name="kpp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>КПП</FormLabel>
                <FormControl>
                  <Input {...field} disabled={disabled} inputMode="numeric" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        <FormField
          control={form.control}
          name="ogrn"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{isOrg ? 'ОГРН' : 'ОГРНИП'}</FormLabel>
              <FormControl>
                <Input {...field} disabled={disabled} inputMode="numeric" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Заметка</FormLabel>
            <FormControl>
              <Textarea {...field} disabled={disabled} rows={3} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
