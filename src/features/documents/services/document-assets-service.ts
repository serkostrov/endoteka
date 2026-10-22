import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'

const BUCKET = 'document-template-assets'
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'] as const
const MAX_BYTES = 5 * 1024 * 1024

export const DOCUMENT_TEMPLATE_ASSET_ACCEPT =
  'image/jpeg,image/png,image/webp,image/jpg,.jpg,.jpeg,.png,.webp'

export type UploadedDocumentAsset = {
  url: string
  path: string
  fileName: string
}

function resolveImageMime(file: File): string | null {
  const type = file.type.trim().toLowerCase()
  if ((ALLOWED_MIME as readonly string[]).includes(type)) {
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
  return null
}

function extensionForMime(mime: string) {
  if (mime === 'image/png') {
    return '.png'
  }
  if (mime === 'image/webp') {
    return '.webp'
  }
  return '.jpg'
}

/** Публичный URL загруженной картинки шаблона. */
export function publicDocumentAssetUrl(path: string): string {
  const { data } = getSupabase().storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * Загрузка логотипа / картинки для шаблона документа.
 * Нужно право documents:edit_templates.
 */
export async function uploadDocumentTemplateAsset(file: File): Promise<UploadedDocumentAsset> {
  const mime = resolveImageMime(file)
  if (!mime) {
    throw toAppError(
      { message: 'Можно загрузить только JPEG, PNG или WebP.' },
      'Можно загрузить только JPEG, PNG или WebP.',
    )
  }
  if (file.size > MAX_BYTES) {
    throw toAppError({ message: 'Файл больше 5 МБ.' }, 'Файл больше 5 МБ.')
  }

  const supabase = getSupabase()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    throw toAppError(userError, 'Нужна авторизация.')
  }

  const extension = extensionForMime(mime)
  const path = `${user.id}/${crypto.randomUUID()}${extension}`
  const payload = new File([file], `asset${extension}`, { type: mime })

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, payload, {
    contentType: mime,
    upsert: false,
    cacheControl: '31536000',
  })
  if (uploadError) {
    throw toAppError(uploadError, 'Не удалось загрузить изображение.')
  }

  return {
    url: publicDocumentAssetUrl(path),
    path,
    fileName: file.name,
  }
}
