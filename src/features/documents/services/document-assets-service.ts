import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'

const BUCKET = 'document-template-assets'

/** Без ограничения формата — любой файл с компьютера. */
export const DOCUMENT_TEMPLATE_ASSET_ACCEPT = '*/*'

export type UploadedDocumentAsset = {
  url: string
  path: string
  fileName: string
}

function extensionFromFile(file: File) {
  const fromName = file.name.match(/(\.[a-zA-Z0-9]+)$/)?.[1]?.toLowerCase()
  if (fromName && fromName.length <= 8) {
    return fromName
  }
  const mime = file.type.trim().toLowerCase()
  if (mime === 'image/png') {
    return '.png'
  }
  if (mime === 'image/webp') {
    return '.webp'
  }
  if (mime === 'image/gif') {
    return '.gif'
  }
  if (mime === 'image/svg+xml') {
    return '.svg'
  }
  if (mime === 'image/bmp') {
    return '.bmp'
  }
  if (mime === 'image/tiff') {
    return '.tiff'
  }
  if (mime === 'image/heic' || mime === 'image/heif') {
    return '.heic'
  }
  return '.jpg'
}

function contentTypeForUpload(file: File) {
  const mime = file.type.trim().toLowerCase()
  if (mime.startsWith('image/')) {
    return mime === 'image/jpg' ? 'image/jpeg' : mime
  }
  const ext = extensionFromFile(file)
  if (ext === '.png') {
    return 'image/png'
  }
  if (ext === '.webp') {
    return 'image/webp'
  }
  if (ext === '.gif') {
    return 'image/gif'
  }
  if (ext === '.svg') {
    return 'image/svg+xml'
  }
  return 'application/octet-stream'
}

/** Публичный URL загруженной картинки шаблона. */
export function publicDocumentAssetUrl(path: string): string {
  const { data } = getSupabase().storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * Загрузка логотипа / картинки для шаблона документа.
 * Без лимита размера и формата на клиенте — принимает любой выбранный файл.
 */
export async function uploadDocumentTemplateAsset(file: File): Promise<UploadedDocumentAsset> {
  if (!file || file.size <= 0) {
    throw toAppError({ message: 'Выберите файл.' }, 'Выберите файл.')
  }

  const supabase = getSupabase()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    throw toAppError(userError, 'Нужна авторизация.')
  }

  const extension = extensionFromFile(file)
  const contentType = contentTypeForUpload(file)
  const path = `${user.id}/${crypto.randomUUID()}${extension}`
  const payload = new File([file], `asset${extension}`, { type: contentType })

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, payload, {
    contentType,
    upsert: false,
    cacheControl: '31536000',
  })
  if (uploadError) {
    throw toAppError(uploadError, 'Не удалось загрузить файл.')
  }

  return {
    url: publicDocumentAssetUrl(path),
    path,
    fileName: file.name,
  }
}
