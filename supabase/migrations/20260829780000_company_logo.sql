-- Настраиваемый логотип компании: бакет, настройки, RPC.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logo',
  'company-logo',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.app_settings (key, value)
values ('company_logo', jsonb_build_object('path', ''))
on conflict (key) do nothing;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select
  on public.app_settings
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('settings:read')
      or key = 'company_logo'
      or (
        key in ('order_number', 'deadline')
        and (
          public.has_permission('orders:read')
          or public.has_permission('orders:create')
        )
      )
    )
  );

drop policy if exists company_logo_select on storage.objects;
create policy company_logo_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'company-logo');

drop policy if exists company_logo_insert on storage.objects;
create policy company_logo_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'company-logo'
    and public.has_permission('settings:update')
  );

drop policy if exists company_logo_update on storage.objects;
create policy company_logo_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'company-logo'
    and public.has_permission('settings:update')
  )
  with check (
    bucket_id = 'company-logo'
    and public.has_permission('settings:update')
  );

drop policy if exists company_logo_delete on storage.objects;
create policy company_logo_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'company-logo'
    and public.has_permission('settings:update')
  );

create or replace function public.get_company_logo()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  logo_path text;
begin
  if not public.is_active_user() then
    raise exception 'Нужна авторизация.';
  end if;

  select nullif(btrim(coalesce(value ->> 'path', '')), '')
    into logo_path
  from public.app_settings
  where key = 'company_logo';

  return logo_path;
end;
$$;

create or replace function public.set_company_logo(file_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
  safe_path text;
begin
  perform public.assert_settings_write();

  safe_path := btrim(coalesce(file_path, ''));
  if safe_path = '' then
    raise exception 'Не указан файл логотипа.';
  end if;

  if position('..' in safe_path) > 0 or left(safe_path, 1) = '/' then
    raise exception 'Некорректный путь логотипа.';
  end if;

  select nullif(btrim(coalesce(value ->> 'path', '')), '')
    into old_path
  from public.app_settings
  where key = 'company_logo';

  insert into public.app_settings (key, value)
  values ('company_logo', jsonb_build_object('path', safe_path))
  on conflict (key) do update
    set value = excluded.value;

  perform public.record_audit(
    'settings.company_logo_updated',
    'app_settings',
    'company_logo',
    jsonb_build_object('path', safe_path)
  );

  return old_path;
end;
$$;

create or replace function public.clear_company_logo()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
begin
  perform public.assert_settings_write();

  select nullif(btrim(coalesce(value ->> 'path', '')), '')
    into old_path
  from public.app_settings
  where key = 'company_logo';

  insert into public.app_settings (key, value)
  values ('company_logo', jsonb_build_object('path', ''))
  on conflict (key) do update
    set value = excluded.value;

  perform public.record_audit(
    'settings.company_logo_cleared',
    'app_settings',
    'company_logo',
    '{}'::jsonb
  );

  return old_path;
end;
$$;

revoke all on function public.get_company_logo() from public;
revoke all on function public.set_company_logo(text) from public;
revoke all on function public.clear_company_logo() from public;

grant execute on function public.get_company_logo() to authenticated;
grant execute on function public.set_company_logo(text) to authenticated;
grant execute on function public.clear_company_logo() to authenticated;
