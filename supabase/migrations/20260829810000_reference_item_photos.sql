-- Фото для записей справочника видов приборов (модель / модификация и др.).

create table if not exists public.reference_item_photos (
  id uuid primary key default gen_random_uuid(),
  reference_item_id uuid not null references public.reference_items (id) on delete cascade,
  file_path text not null,
  file_name text not null default '',
  mime_type text not null default 'image/jpeg',
  file_size integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists reference_item_photos_item_idx
  on public.reference_item_photos (reference_item_id, sort_order, created_at);

alter table public.reference_item_photos enable row level security;

drop policy if exists reference_item_photos_select on public.reference_item_photos;
create policy reference_item_photos_select
  on public.reference_item_photos
  for select
  to authenticated
  using (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reference-item-photos',
  'reference-item-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do nothing;

drop policy if exists reference_item_photos_select on storage.objects;
create policy reference_item_photos_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'reference-item-photos'
    and (
      public.has_permission('devices:read')
      or public.has_permission('settings:update')
      or public.can_read_inventory()
      or public.has_permission('orders:read')
    )
  );

drop policy if exists reference_item_photos_insert on storage.objects;
create policy reference_item_photos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'reference-item-photos'
    and public.has_permission('settings:update')
  );

drop policy if exists reference_item_photos_delete on storage.objects;
create policy reference_item_photos_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'reference-item-photos'
    and public.has_permission('settings:update')
  );

create or replace function public.list_reference_item_photos(target_reference_item_id uuid)
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
  if not (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  ) then
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
  from public.reference_item_photos p
  where p.reference_item_id = target_reference_item_id
  order by p.sort_order, p.created_at;
end;
$$;

create or replace function public.register_reference_item_photo(
  target_reference_item_id uuid,
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
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для загрузки фото.';
  end if;

  if not exists (select 1 from public.reference_items where id = target_reference_item_id) then
    raise exception 'Запись справочника не найдена.';
  end if;

  if btrim(coalesce(file_path, '')) = '' then
    raise exception 'Не указан файл.';
  end if;

  if split_part(file_path, '/', 1) <> target_reference_item_id::text then
    raise exception 'Некорректный путь файла.';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into next_order
  from public.reference_item_photos
  where reference_item_id = target_reference_item_id;

  insert into public.reference_item_photos (
    reference_item_id, file_path, file_name, mime_type, file_size, sort_order, created_by
  )
  values (
    target_reference_item_id,
    file_path,
    coalesce(file_name, ''),
    coalesce(mime_type, 'image/jpeg'),
    coalesce(file_size, 0),
    next_order,
    auth.uid()
  )
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.delete_reference_item_photo(target_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_item_photos%rowtype;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для удаления фото.';
  end if;

  select * into current_row
  from public.reference_item_photos
  where id = target_photo_id
  for update;

  if not found then
    raise exception 'Фото не найдено.';
  end if;

  delete from public.reference_item_photos
  where id = target_photo_id;

  return current_row.file_path;
end;
$$;

create or replace function public.set_reference_item_photo_cover(target_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_item_photos%rowtype;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения фото.';
  end if;

  select * into current_row
  from public.reference_item_photos
  where id = target_photo_id
  for update;

  if not found then
    raise exception 'Фото не найдено.';
  end if;

  with ordered as (
    select
      p.id,
      row_number() over (
        order by
          case when p.id = target_photo_id then -1 else p.sort_order end,
          p.created_at
      ) - 1 as new_order
    from public.reference_item_photos p
    where p.reference_item_id = current_row.reference_item_id
  )
  update public.reference_item_photos p
  set sort_order = ordered.new_order
  from ordered
  where p.id = ordered.id;
end;
$$;

revoke all on function public.list_reference_item_photos(uuid) from public, anon;
revoke all on function public.register_reference_item_photo(uuid, text, text, text, integer) from public, anon;
revoke all on function public.delete_reference_item_photo(uuid) from public, anon;
revoke all on function public.set_reference_item_photo_cover(uuid) from public, anon;

grant execute on function public.list_reference_item_photos(uuid) to authenticated;
grant execute on function public.register_reference_item_photo(uuid, text, text, text, integer) to authenticated;
grant execute on function public.delete_reference_item_photo(uuid) to authenticated;
grant execute on function public.set_reference_item_photo_cover(uuid) to authenticated;
