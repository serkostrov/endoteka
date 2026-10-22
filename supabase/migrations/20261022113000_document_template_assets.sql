-- Картинки для шаблонов документов (логотипы и изображения).
-- Публичный bucket: URL стабилен при печати и в сохранённых шаблонах.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-template-assets',
  'document-template-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists document_template_assets_select on storage.objects;
create policy document_template_assets_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'document-template-assets');

drop policy if exists document_template_assets_insert on storage.objects;
create policy document_template_assets_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'document-template-assets'
    and public.has_permission('documents:edit_templates')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists document_template_assets_update on storage.objects;
create policy document_template_assets_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'document-template-assets'
    and public.has_permission('documents:edit_templates')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'document-template-assets'
    and public.has_permission('documents:edit_templates')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists document_template_assets_delete on storage.objects;
create policy document_template_assets_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'document-template-assets'
    and public.has_permission('documents:edit_templates')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
