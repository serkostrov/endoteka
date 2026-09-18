-- Надёжные бакеты/политики для аватаров и фото позиций склада.

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.inventory_items
  add column if not exists barcode_type text not null default 'code128';

create table if not exists public.inventory_item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  file_path text not null,
  file_name text not null default '',
  mime_type text not null default 'image/jpeg',
  file_size integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.inventory_item_photos enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-item-photos',
  'inventory-item-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Аватары: путь userId/...
drop policy if exists profile_avatars_select on storage.objects;
drop policy if exists profile_avatars_public_select on storage.objects;
drop policy if exists profile_avatars_insert on storage.objects;
drop policy if exists profile_avatars_update on storage.objects;
drop policy if exists profile_avatars_delete on storage.objects;

create policy profile_avatars_public_select
  on storage.objects
  for select
  to public
  using (bucket_id = 'profile-avatars');

create policy profile_avatars_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy profile_avatars_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy profile_avatars_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Фото позиций: путь itemId/...
drop policy if exists inventory_item_photos_select on storage.objects;
drop policy if exists inventory_item_photos_insert on storage.objects;
drop policy if exists inventory_item_photos_update on storage.objects;
drop policy if exists inventory_item_photos_delete on storage.objects;

create policy inventory_item_photos_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'inventory-item-photos'
    and public.can_read_inventory()
  );

create policy inventory_item_photos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'inventory-item-photos'
    and public.has_permission('inventory:receive')
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

create policy inventory_item_photos_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'inventory-item-photos'
    and public.has_permission('inventory:receive')
  );

-- RLS на таблице фото (если политика ещё не создана)
drop policy if exists inventory_item_photos_select on public.inventory_item_photos;
create policy inventory_item_photos_select on public.inventory_item_photos
  for select to authenticated
  using (public.can_read_inventory());

-- RPC аватара (на случай, если 2948 не применили)
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

-- RPC фото склада (на случай, если 2947 не применили)
create or replace function public.register_inventory_item_photo(
  target_item_id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для загрузки фото.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if btrim(coalesce(file_path, '')) = '' then
    raise exception 'Не указан файл.';
  end if;

  if split_part(file_path, '/', 1) <> target_item_id::text then
    raise exception 'Некорректный путь файла.';
  end if;

  select coalesce(max(sort_order), -1) + 1
  into next_order
  from public.inventory_item_photos
  where item_id = target_item_id;

  insert into public.inventory_item_photos (
    item_id, file_path, file_name, mime_type, file_size, sort_order, created_by
  )
  values (
    target_item_id,
    file_path,
    coalesce(file_name, ''),
    coalesce(mime_type, 'image/jpeg'),
    greatest(coalesce(file_size, 0), 0),
    next_order,
    auth.uid()
  )
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.delete_inventory_item_photo(target_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_item_photos%rowtype;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления фото.';
  end if;

  select * into current_row
  from public.inventory_item_photos
  where id = target_photo_id
  for update;

  if current_row.id is null then
    raise exception 'Фото не найдено.';
  end if;

  delete from public.inventory_item_photos
  where id = target_photo_id;

  return current_row.file_path;
end;
$$;

create or replace function public.list_inventory_item_photos(target_item_id uuid)
returns table (
  id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer,
  sort_order integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра фото.';
  end if;

  return query
  select
    p.id,
    p.file_path,
    p.file_name,
    p.mime_type,
    p.file_size,
    p.sort_order,
    p.created_at
  from public.inventory_item_photos p
  where p.item_id = target_item_id
  order by p.sort_order, p.created_at;
end;
$$;

revoke all on function public.register_inventory_item_photo(uuid, text, text, text, integer) from public;
revoke all on function public.delete_inventory_item_photo(uuid) from public;
revoke all on function public.list_inventory_item_photos(uuid) from public;
grant execute on function public.register_inventory_item_photo(uuid, text, text, text, integer) to authenticated;
grant execute on function public.delete_inventory_item_photo(uuid) to authenticated;
grant execute on function public.list_inventory_item_photos(uuid) to authenticated;
