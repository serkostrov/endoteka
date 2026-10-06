import { getSupabase } from '@/lib/supabase/client'
import { toAppError } from '@/lib/errors'

const COMPANY_LOGO_BUCKET = 'company-logo'
const COMPANY_LOGO_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'image/svg+xml',
]
const COMPANY_LOGO_MAX_BYTES = 5 * 1024 * 1024

export const COMPANY_LOGO_ACCEPT =
  'image/jpeg,image/png,image/webp,image/jpg,image/svg+xml,.jpg,.jpeg,.png,.webp,.svg'

export function publicCompanyLogoUrl(path: string | null | undefined): string | null {
  if (!path) {
    return null
  }
  try {
    const { data } = getSupabase().storage.from(COMPANY_LOGO_BUCKET).getPublicUrl(path)
    return data.publicUrl || null
  } catch {
    return null
  }
}

function resolveLogoMime(file: File): string | null {
  const type = file.type.trim().toLowerCase()
  if (COMPANY_LOGO_MIME.includes(type)) {
    return type === 'image/jpg' ? 'image/jpeg' : type
  }
  const name = file.name.toLowerCase()
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (name.endsWith('.png')) {
    return 'image/png'
  }
  if (name.endsWith('.webp')) {
    return 'image/webp'
  }
  if (name.endsWith('.svg')) {
    return 'image/svg+xml'
  }
  return null
}

function extensionForMime(mime: string) {
  if (mime === 'image/png') {
    return '.png'
  }
  if (mime === 'image/webp') {
    return '.webp'
  }
  if (mime === 'image/svg+xml') {
    return '.svg'
  }
  return '.jpg'
}

export async function getCompanyLogoUrl(): Promise<string | null> {
  const { data, error } = await getSupabase().rpc('get_company_logo')
  if (error || typeof data !== 'string' || !data.trim()) {
    return null
  }
  return publicCompanyLogoUrl(data)
}

export async function uploadCompanyLogo(file: File): Promise<string> {
  const mime = resolveLogoMime(file)
  if (!mime) {
    throw toAppError(
      { message: 'Можно загрузить только JPEG, PNG, WebP или SVG.' },
      'Можно загрузить только JPEG, PNG, WebP или SVG.',
    )
  }
  if (file.size > COMPANY_LOGO_MAX_BYTES) {
    throw toAppError({ message: 'Файл больше 5 МБ.' }, 'Файл больше 5 МБ.')
  }

  const supabase = getSupabase()
  const extension = extensionForMime(mime)
  const path = `logo/${crypto.randomUUID()}${extension}`
  const payload = new File([file], `logo${extension}`, { type: mime })

  const { error: uploadError } = await supabase.storage.from(COMPANY_LOGO_BUCKET).upload(path, payload, {
    contentType: mime,
    upsert: true,
    cacheControl: '3600',
  })
  if (uploadError) {
    throw toAppError(uploadError, 'Не удалось загрузить логотип.')
  }

  const { data: oldPath, error } = await supabase.rpc('set_company_logo', { file_path: path })
  if (error) {
    await supabase.storage.from(COMPANY_LOGO_BUCKET).remove([path])
    throw toAppError(error, 'Не удалось сохранить логотип.')
  }

  if (typeof oldPath === 'string' && oldPath) {
    await supabase.storage.from(COMPANY_LOGO_BUCKET).remove([oldPath])
  }

  return publicCompanyLogoUrl(path) ?? path
}

export async function removeCompanyLogo(): Promise<void> {
  const supabase = getSupabase()
  const { data: oldPath, error } = await supabase.rpc('clear_company_logo')
  if (error) {
    throw toAppError(error, 'Не удалось удалить логотип.')
  }
  if (typeof oldPath === 'string' && oldPath) {
    await supabase.storage.from(COMPANY_LOGO_BUCKET).remove([oldPath])
  }
}
