import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'

const PHOTOS_BUCKET = 'reference-item-photos'
const PHOTO_MAX_BYTES = 10 * 1024 * 1024
const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'] as const

export const REFERENCE_ITEM_PHOTO_ACCEPT =
  'image/jpeg,image/png,image/webp,image/jpg,.jpg,.jpeg,.png,.webp'

export type ReferenceItemPhoto = {
  id: string
  filePath: string
  fileName: string
  mimeType: string
  fileSize: number
  sortOrder: number
  createdAt: string
  signedUrl: string | null
}

function resolvePhotoMime(file: File): string | null {
  const type = file.type.trim().toLowerCase()
  if ((PHOTO_MIME as readonly string[]).includes(type)) {
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

export function validateReferenceItemPhoto(file: File): void {
  if (file.size > PHOTO_MAX_BYTES) {
    throw toAppError({ message: 'Фото больше 10 МБ.' }, 'Фото больше 10 МБ.')
  }
  if (!resolvePhotoMime(file)) {
    throw toAppError(
      { message: 'Можно загрузить только JPEG, PNG или WebP.' },
      'Можно загрузить только JPEG, PNG или WebP.',
    )
  }
}

export async function listReferenceItemPhotos(referenceItemId: string): Promise<ReferenceItemPhoto[]> {
  const { data, error } = await getSupabase().rpc('list_reference_item_photos', {
    target_reference_item_id: referenceItemId,
  })
  if (error) {
    throw toAppError(error, 'Не удалось загрузить фото.')
  }

  const rows = data ?? []
  return Promise.all(
    rows.map(async (row) => {
      const signed = await getSupabase().storage.from(PHOTOS_BUCKET).createSignedUrl(row.file_path, 3600)
      return {
        id: row.id,
        filePath: row.file_path,
        fileName: row.file_name,
        mimeType: row.mime_type,
        fileSize: row.file_size,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        signedUrl: signed.data?.signedUrl ?? null,
      }
    }),
  )
}

export async function uploadReferenceItemPhoto(referenceItemId: string, file: File): Promise<void> {
  validateReferenceItemPhoto(file)
  const mime = resolvePhotoMime(file) ?? 'image/jpeg'
  const extension = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.'))
    : mime === 'image/png'
      ? '.png'
      : mime === 'image/webp'
        ? '.webp'
        : '.jpg'
  const path = `${referenceItemId}/${crypto.randomUUID()}${extension}`
  const payload = new File([file], file.name || `photo${extension}`, { type: mime })
  const supabase = getSupabase()
  const { error: uploadError } = await supabase.storage.from(PHOTOS_BUCKET).upload(path, payload, {
    contentType: mime,
    upsert: false,
    cacheControl: '3600',
  })
  if (uploadError) {
    throw toAppError(uploadError, 'Не удалось загрузить фото.')
  }

  const { error } = await supabase.rpc('register_reference_item_photo', {
    target_reference_item_id: referenceItemId,
    file_path: path,
    file_name: file.name || `photo${extension}`,
    mime_type: mime,
    file_size: file.size,
  })
  if (error) {
    await supabase.storage.from(PHOTOS_BUCKET).remove([path])
    throw toAppError(error, 'Не удалось сохранить фото.')
  }
}

export async function deleteReferenceItemPhoto(photoId: string, filePath: string | null): Promise<void> {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('delete_reference_item_photo', {
    target_photo_id: photoId,
  })
  if (error) {
    throw toAppError(error, 'Не удалось удалить фото.')
  }
  const path = filePath || data
  if (path) {
    await supabase.storage.from(PHOTOS_BUCKET).remove([path])
  }
}

export async function setReferenceItemPhotoCover(photoId: string): Promise<void> {
  const { error } = await getSupabase().rpc('set_reference_item_photo_cover', {
    target_photo_id: photoId,
  })
  if (error) {
    throw toAppError(error, 'Не удалось обновить обложку.')
  }
}
