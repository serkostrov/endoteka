import { z } from 'zod'

import { CustomerKind, customerKindLabels } from '@/lib/constants/customers'

const emailSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Некорректный email')

export const customerFormSchema = z
  .object({
    kind: z.enum([CustomerKind.Organization, CustomerKind.Individual]),
    name: z.string().trim().min(1, 'Укажите название или ФИО'),
    contactName: z.string().trim(),
    phone: z.string().trim(),
    email: emailSchema,
    city: z.string().trim(),
    inn: z.string().trim(),
    kpp: z.string().trim(),
    ogrn: z.string().trim(),
    notes: z.string().trim(),
  })
  .superRefine((value, ctx) => {
    if (value.inn && !/^\d+$/.test(value.inn)) {
      ctx.addIssue({ code: 'custom', path: ['inn'], message: 'ИНН должен содержать только цифры' })
    }
    if (value.kind === CustomerKind.Organization && value.kpp && !/^\d{9}$/.test(value.kpp)) {
      ctx.addIssue({ code: 'custom', path: ['kpp'], message: 'КПП — 9 цифр' })
    }
    if (value.ogrn && !/^\d{13}$|^\d{15}$/.test(value.ogrn)) {
      ctx.addIssue({ code: 'custom', path: ['ogrn'], message: 'ОГРН — 13 цифр, ОГРНИП — 15' })
    }
  })

export type CustomerFormValues = z.infer<typeof customerFormSchema>

export const emptyCustomerFormValues: CustomerFormValues = {
  kind: CustomerKind.Organization,
  name: '',
  contactName: '',
  phone: '',
  email: '',
  city: '',
  inn: '',
  kpp: '',
  ogrn: '',
  notes: '',
}

export function emptyCustomerForm(kind: CustomerKind = CustomerKind.Organization): CustomerFormValues {
  return { ...emptyCustomerFormValues, kind }
}

export function nameLabel(kind: string) {
  return kind === CustomerKind.Individual ? 'ФИО' : 'Название организации'
}

export function customerKindLabel(kind: string) {
  return kind === CustomerKind.Individual || kind === CustomerKind.Organization
    ? customerKindLabels[kind]
    : 'Клиент'
}
