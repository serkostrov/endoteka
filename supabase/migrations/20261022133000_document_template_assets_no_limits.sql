-- Убрать лимиты размера и MIME для картинок шаблонов документов.

update storage.buckets
set
  file_size_limit = null,
  allowed_mime_types = null
where id = 'document-template-assets';
