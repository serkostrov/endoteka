-- Логотип компании виден без входа: экран входа, favicon, публичные страницы.

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
  select nullif(btrim(coalesce(value ->> 'path', '')), '')
    into logo_path
  from public.app_settings
  where key = 'company_logo';

  return logo_path;
end;
$$;

revoke all on function public.get_company_logo() from public;
grant execute on function public.get_company_logo() to anon, authenticated;

drop policy if exists company_logo_select on storage.objects;
create policy company_logo_select
  on storage.objects
  for select
  to public
  using (bucket_id = 'company-logo');
