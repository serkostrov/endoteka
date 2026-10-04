-- Группы подходящих запчастей на карточке вида прибора + порядок внутри группы.

create table if not exists public.device_compatible_part_groups (
  id uuid primary key default gen_random_uuid(),
  reference_item_id uuid not null references public.reference_items (id) on delete cascade,
  name text not null,
  color text not null default '#2563eb',
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint device_compatible_part_groups_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint device_compatible_part_groups_color_format check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create index if not exists device_compatible_part_groups_reference_idx
  on public.device_compatible_part_groups (reference_item_id, sort_order, created_at);

alter table public.device_compatible_parts
  add column if not exists group_id uuid references public.device_compatible_part_groups (id) on delete cascade;

create index if not exists device_compatible_parts_group_idx
  on public.device_compatible_parts (group_id, sort_order, created_at);

-- Для уже связанных деталей создаём группу «Основные» на каждом виде.
insert into public.device_compatible_part_groups (reference_item_id, name, color, sort_order, created_by)
select distinct
  link.reference_item_id,
  'Основные',
  '#2563eb',
  0,
  auth.uid()
from public.device_compatible_parts link
where link.group_id is null
  and not exists (
    select 1
    from public.device_compatible_part_groups g
    where g.reference_item_id = link.reference_item_id
  );

update public.device_compatible_parts link
set group_id = g.id
from public.device_compatible_part_groups g
where link.group_id is null
  and g.reference_item_id = link.reference_item_id;

alter table public.device_compatible_parts
  alter column group_id set not null;

alter table public.device_compatible_part_groups enable row level security;

drop policy if exists device_compatible_part_groups_select on public.device_compatible_part_groups;
create policy device_compatible_part_groups_select
  on public.device_compatible_part_groups
  for select
  to authenticated
  using (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  );

create or replace function public.list_device_compatible_part_groups(target_reference_item_id uuid)
returns table (
  id uuid,
  reference_item_id uuid,
  name text,
  color text,
  sort_order integer,
  part_count integer,
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
    raise exception 'Недостаточно прав для просмотра групп деталей.';
  end if;

  if target_reference_item_id is null then
    raise exception 'Не указан вид прибора.';
  end if;

  return query
  select
    g.id,
    g.reference_item_id,
    g.name,
    g.color,
    g.sort_order,
    (
      select count(*)::integer
      from public.device_compatible_parts p
      where p.group_id = g.id
    ) as part_count,
    g.created_at
  from public.device_compatible_part_groups g
  where g.reference_item_id = target_reference_item_id
  order by g.sort_order, g.created_at;
end;
$$;

create or replace function public.upsert_device_compatible_part_group(
  target_id uuid,
  target_reference_item_id uuid,
  target_name text,
  target_color text default '#2563eb'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
  cleaned_name text := btrim(coalesce(target_name, ''));
  cleaned_color text := upper(coalesce(nullif(btrim(target_color), ''), '#2563EB'));
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения групп деталей.';
  end if;

  if target_reference_item_id is null or not exists (
    select 1 from public.reference_items where id = target_reference_item_id
  ) then
    raise exception 'Вид прибора не найден.';
  end if;

  if cleaned_name = '' then
    raise exception 'Укажите название группы.';
  end if;

  if cleaned_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Цвет группы задан некорректно.';
  end if;

  if target_id is null then
    select coalesce(max(sort_order), -1) + 1
      into next_order
    from public.device_compatible_part_groups
    where reference_item_id = target_reference_item_id;

    insert into public.device_compatible_part_groups (
      reference_item_id, name, color, sort_order, created_by
    )
    values (
      target_reference_item_id, cleaned_name, cleaned_color, next_order, auth.uid()
    )
    returning id into result_id;
  else
    update public.device_compatible_part_groups
    set name = cleaned_name,
        color = cleaned_color
    where id = target_id
      and reference_item_id = target_reference_item_id
    returning id into result_id;

    if result_id is null then
      raise exception 'Группа не найдена.';
    end if;
  end if;

  return result_id;
end;
$$;

create or replace function public.delete_device_compatible_part_group(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  part_count integer;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения групп деталей.';
  end if;

  if not exists (select 1 from public.device_compatible_part_groups where id = target_id) then
    raise exception 'Группа не найдена.';
  end if;

  select count(*) into part_count
  from public.device_compatible_parts
  where group_id = target_id;

  if part_count > 0 then
    raise exception 'Сначала уберите детали из группы.';
  end if;

  delete from public.device_compatible_part_groups where id = target_id;
end;
$$;

create or replace function public.reorder_device_compatible_part_groups(
  target_reference_item_id uuid,
  group_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения групп деталей.';
  end if;

  if group_ids is null or array_length(group_ids, 1) is null then
    raise exception 'Передайте порядок групп.';
  end if;

  select count(*) into expected_count
  from public.device_compatible_part_groups
  where reference_item_id = target_reference_item_id;

  select count(*) into matched_count
  from public.device_compatible_part_groups
  where reference_item_id = target_reference_item_id
    and id = any (group_ids);

  if expected_count <> array_length(group_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все группы этого вида.';
  end if;

  update public.device_compatible_part_groups g
  set sort_order = o.ord - 1
  from unnest(group_ids) with ordinality as o(id, ord)
  where g.id = o.id
    and g.reference_item_id = target_reference_item_id;
end;
$$;

create or replace function public.reorder_device_compatible_parts(
  target_group_id uuid,
  link_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения подходящих деталей.';
  end if;

  if target_group_id is null or not exists (
    select 1 from public.device_compatible_part_groups where id = target_group_id
  ) then
    raise exception 'Группа не найдена.';
  end if;

  if link_ids is null or array_length(link_ids, 1) is null then
    raise exception 'Передайте порядок деталей.';
  end if;

  select count(*) into expected_count
  from public.device_compatible_parts
  where group_id = target_group_id;

  select count(*) into matched_count
  from public.device_compatible_parts
  where group_id = target_group_id
    and id = any (link_ids);

  if expected_count <> array_length(link_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все детали группы.';
  end if;

  update public.device_compatible_parts p
  set sort_order = o.ord - 1
  from unnest(link_ids) with ordinality as o(id, ord)
  where p.id = o.id
    and p.group_id = target_group_id;
end;
$$;

drop function if exists public.list_device_compatible_parts(uuid);
create or replace function public.list_device_compatible_parts(target_reference_item_id uuid)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
  cover_file_path text,
  link_id uuid,
  group_id uuid,
  group_name text,
  group_color text,
  group_sort_order integer,
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
    raise exception 'Недостаточно прав для просмотра подходящих деталей.';
  end if;

  if target_reference_item_id is null then
    raise exception 'Не указан вид прибора.';
  end if;

  return query
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '')::text as category_name,
    i.unit_id,
    coalesce(u.name, '')::text as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    public.inventory_item_stock_qty(i.id) as stock_quantity,
    (
      select p.file_path
      from public.inventory_item_photos p
      where p.item_id = i.id
      order by p.sort_order, p.created_at
      limit 1
    ) as cover_file_path,
    link.id as link_id,
    g.id as group_id,
    g.name as group_name,
    g.color as group_color,
    g.sort_order as group_sort_order,
    link.sort_order,
    link.created_at
  from public.device_compatible_parts link
  join public.device_compatible_part_groups g on g.id = link.group_id
  join public.inventory_items i on i.id = link.item_id
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where link.reference_item_id = target_reference_item_id
  order by g.sort_order, link.sort_order, i.name, link.created_at;
end;
$$;

drop function if exists public.add_device_compatible_part(uuid, uuid);
create or replace function public.add_device_compatible_part(
  target_reference_item_id uuid,
  target_item_id uuid,
  target_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
  resolved_group_id uuid := target_group_id;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения подходящих деталей.';
  end if;

  if target_reference_item_id is null or not exists (
    select 1 from public.reference_items where id = target_reference_item_id
  ) then
    raise exception 'Вид прибора не найден.';
  end if;

  if target_item_id is null or not exists (
    select 1 from public.inventory_items where id = target_item_id
  ) then
    raise exception 'Позиция номенклатуры не найдена.';
  end if;

  if resolved_group_id is null then
    select g.id
      into resolved_group_id
    from public.device_compatible_part_groups g
    where g.reference_item_id = target_reference_item_id
    order by g.sort_order, g.created_at
    limit 1;

    if resolved_group_id is null then
      insert into public.device_compatible_part_groups (
        reference_item_id, name, color, sort_order, created_by
      )
      values (
        target_reference_item_id, 'Основные', '#2563eb', 0, auth.uid()
      )
      returning id into resolved_group_id;
    end if;
  else
    if not exists (
      select 1
      from public.device_compatible_part_groups
      where id = resolved_group_id
        and reference_item_id = target_reference_item_id
    ) then
      raise exception 'Группа не найдена для этого вида прибора.';
    end if;
  end if;

  select coalesce(max(sort_order), -1) + 1
    into next_order
  from public.device_compatible_parts
  where group_id = resolved_group_id;

  insert into public.device_compatible_parts (
    reference_item_id, item_id, group_id, sort_order, created_by
  )
  values (
    target_reference_item_id, target_item_id, resolved_group_id, next_order, auth.uid()
  )
  on conflict (reference_item_id, item_id) do update
    set sort_order = public.device_compatible_parts.sort_order,
        group_id = public.device_compatible_parts.group_id
  returning id into result_id;

  return result_id;
end;
$$;

revoke all on function public.list_device_compatible_part_groups(uuid) from public, anon;
revoke all on function public.upsert_device_compatible_part_group(uuid, uuid, text, text) from public, anon;
revoke all on function public.delete_device_compatible_part_group(uuid) from public, anon;
revoke all on function public.reorder_device_compatible_part_groups(uuid, uuid[]) from public, anon;
revoke all on function public.reorder_device_compatible_parts(uuid, uuid[]) from public, anon;
revoke all on function public.list_device_compatible_parts(uuid) from public, anon;
revoke all on function public.add_device_compatible_part(uuid, uuid, uuid) from public, anon;

grant execute on function public.list_device_compatible_part_groups(uuid) to authenticated;
grant execute on function public.upsert_device_compatible_part_group(uuid, uuid, text, text) to authenticated;
grant execute on function public.delete_device_compatible_part_group(uuid) to authenticated;
grant execute on function public.reorder_device_compatible_part_groups(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_device_compatible_parts(uuid, uuid[]) to authenticated;
grant execute on function public.list_device_compatible_parts(uuid) to authenticated;
grant execute on function public.add_device_compatible_part(uuid, uuid, uuid) to authenticated;
