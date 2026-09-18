import type { UseFormReturn } from 'react-hook-form'

import { EntitySheetLink } from '@/components/shared/EntitySheetLink'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CUSTOMER_SEARCH_DEBOUNCE_MS, CustomerKind, customerKindLabels } from '@/lib/constants/customers'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

import { useCustomerInnMatches } from '../hooks/use-customers'
import { nameLabel, type CustomerFormValues } from '../schemas'

type CustomerFieldsProps = {
  form: UseFormReturn<CustomerFormValues>
  disabled?: boolean
  excludeCustomerId?: string
  hideKind?: boolean
  /** Скрыть имя — когда оно в шапке. */
  hideName?: boolean
  /** Карточка: сетка 2 колонки. */
  layout?: 'form' | 'card'
}

export function CustomerFields({
  form,
  disabled = false,
  excludeCustomerId,
  hideKind = false,
  hideName = false,
  layout = 'form',
}: CustomerFieldsProps) {
  const kind = form.watch('kind')
  const inn = form.watch('inn')
  const isOrg = kind === CustomerKind.Organization
  const debouncedInn = useDebouncedValue(inn.trim(), CUSTOMER_SEARCH_DEBOUNCE_MS)
  const matchesQuery = useCustomerInnMatches(disabled ? '' : debouncedInn, excludeCustomerId)
  const matches = matchesQuery.data ?? []
  const card = layout === 'card'

  return (
    <div className={cn(card ? 'space-y-3' : 'space-y-4')}>
      {matches.length > 0 ? (
        <Alert>
          <AlertTitle>Похожий ИНН уже есть</AlertTitle>
          <AlertDescription>
            <p className="mb-2">Это не запрещает сохранить запись. Проверьте, что это не тот же контакт.</p>
            <ul className="space-y-1">
              {matches.map((item) => (
                <li key={item.id}>
                  <EntitySheetLink kind="customer" id={item.id}>
                    Открыть {item.name}
                  </EntitySheetLink>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {hideKind ? null : (
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
                  <SelectTrigger className="w-full" aria-label="Тип контакта">
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
      )}

      {hideName ? null : (
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{nameLabel(kind)}</FormLabel>
              <FormControl>
                <Input {...field} disabled={disabled} autoComplete={isOrg ? 'organization' : 'name'} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <div className={cn('grid gap-4 sm:grid-cols-2', card && 'gap-3')}>
        <TextField
          form={form}
          name="contactName"
          label={isOrg ? 'Контактное лицо' : 'Доп. контакт'}
          disabled={disabled}
        />
        <TextField form={form} name="city" label="Город" disabled={disabled} />
        <TextField form={form} name="phone" label="Телефон" disabled={disabled} inputMode="tel" />
        <TextField
          form={form}
          name="email"
          label="Email"
          disabled={disabled}
          type="email"
          autoComplete="off"
        />
        <TextField form={form} name="inn" label="ИНН" disabled={disabled} inputMode="numeric" />
        {isOrg ? (
          <TextField form={form} name="kpp" label="КПП" disabled={disabled} inputMode="numeric" />
        ) : null}
        <TextField
          form={form}
          name="ogrn"
          label={isOrg ? 'ОГРН' : 'ОГРНИП'}
          disabled={disabled}
          inputMode="numeric"
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

function TextField({
  form,
  name,
  label,
  disabled,
  type,
  inputMode,
  autoComplete,
}: {
  form: UseFormReturn<CustomerFormValues>
  name: keyof CustomerFormValues
  label: string
  disabled: boolean
  type?: string
  inputMode?: 'tel' | 'numeric' | 'email' | 'text'
  autoComplete?: string
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
              {...field}
              value={typeof field.value === 'string' ? field.value : ''}
              disabled={disabled}
              type={type}
              inputMode={inputMode}
              autoComplete={autoComplete}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
