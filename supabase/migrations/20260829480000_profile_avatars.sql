-- Аватар профиля: колонка, хранилище, RPC.

alter table public.profiles
  add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do nothing;

drop policy if exists profile_avatars_select on storage.objects;
create policy profile_avatars_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'profile-avatars');

drop policy if exists profile_avatars_insert on storage.objects;
create policy profile_avatars_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_avatars_update on storage.objects;
create policy profile_avatars_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_avatars_delete on storage.objects;
create policy profile_avatars_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.set_my_avatar(file_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
  safe_path text;
begin
  if auth.uid() is null then
    raise exception 'Нужна авторизация.';
  end if;

  safe_path := btrim(coalesce(file_path, ''));
  if safe_path = '' then
    raise exception 'Не указан файл аватара.';
  end if;

  if split_part(safe_path, '/', 1) <> auth.uid()::text then
    raise exception 'Нельзя сохранить чужой аватар.';
  end if;

  select avatar_path into old_path
  from public.profiles
  where id = auth.uid()
  for update;

  if not found then
    raise exception 'Профиль не найден.';
  end if;

  update public.profiles
  set avatar_path = safe_path, updated_at = now()
  where id = auth.uid();

  return coalesce(old_path, '');
end;
$$;

create or replace function public.clear_my_avatar()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
begin
  if auth.uid() is null then
    raise exception 'Нужна авторизация.';
  end if;

  select avatar_path into old_path
  from public.profiles
  where id = auth.uid()
  for update;

  if not found then
    raise exception 'Профиль не найден.';
  end if;

  update public.profiles
  set avatar_path = null, updated_at = now()
  where id = auth.uid();

  return coalesce(old_path, '');
end;
$$;

revoke all on function public.set_my_avatar(text) from public;
revoke all on function public.clear_my_avatar() from public;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.clear_my_avatar() to authenticated;
