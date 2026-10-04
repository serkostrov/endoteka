-- Группы запасных частей — единый справочник для всех приборов.
-- Порядок деталей внутри группы остаётся индивидуальным для каждого вида.

-- Сводим дубликаты по названию к одной канонической группе.
create temporary table _compatible_group_map on commit drop as
with ranked as (
  select
    id,
    lower(btrim(name)) as name_key,
    row_number() over (
      partition by lower(btrim(name))
      order by sort_order, created_at, id
    ) as rn
  from public.device_compatible_part_groups
)
select
  r.id as old_id,
  k.id as new_id
from ranked r
join ranked k on k.name_key = r.name_key and k.rn = 1;

update public.device_compatible_parts p
set group_id = m.new_id
from _compatible_group_map m
where p.group_id = m.old_id
  and m.old_id <> m.new_id;

delete from public.device_compatible_part_groups g
using _compatible_group_map m
where g.id = m.old_id
  and m.old_id <> m.new_id;

drop index if exists public.device_compatible_part_groups_reference_idx;

alter table public.device_compatible_part_groups
  drop column if exists reference_item_id;

alter table public.device_compatible_part_groups
  drop constraint if exists device_compatible_part_groups_name_unique;

drop index if exists public.device_compatible_part_groups_name_ci_idx;
create unique index device_compatible_part_groups_name_ci_idx
  on public.device_compatible_part_groups (lower(name));

create index if not exists device_compatible_part_groups_sort_idx
  on public.device_compatible_part_groups (sort_order, created_at);

-- Если групп ещё нет — базовая.
insert into public.device_compatible_part_groups (name, color, sort_order)
select 'Основные', '#2563eb', 0
where not exists (select 1 from public.device_compatible_part_groups);

-- Перенумеровать sort_order подряд.
with ordered as (
  select id, row_number() over (order by sort_order, created_at, id) - 1 as next_order
  from public.device_compatible_part_groups
)
update public.device_compatible_part_groups g
set sort_order = o.next_order
from ordered o
where g.id = o.id;

drop function if exists public.list_device_compatible_part_groups(uuid);
drop function if exists public.upsert_device_compatible_part_group(uuid, uuid, text, text);
drop function if exists public.reorder_device_compatible_part_groups(uuid, uuid[]);
drop function if exists public.reorder_device_compatible_parts(uuid, uuid[]);
drop function if exists public.add_device_compatible_part(uuid, uuid, uuid);

create or replace function public.list_device_compatible_part_groups(
  target_reference_item_id uuid default null
)
returns table (
  id uuid,
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
    or public.has_permission('settings:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  ) then
    raise exception 'Недостаточно прав для просмотра групп деталей.';
  end if;

  return query
  select
    g.id,
    g.name,
    g.color,
    g.sort_order,
    (
      select count(*)::integer
      from public.device_compatible_parts p
      where p.group_id = g.id
        and (
          target_reference_item_id is null
          or p.reference_item_id = target_reference_item_id
        )
    ) as part_count,
    g.created_at
  from public.device_compatible_part_groups g
  order by g.sort_order, g.created_at;
end;
$$;

create or replace function public.upsert_device_compatible_part_group(
  target_id uuid,
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

  if cleaned_name = '' then
    raise exception 'Укажите название группы.';
  end if;

  if cleaned_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Цвет группы задан некорректно.';
  end if;

  if exists (
    select 1
    from public.device_compatible_part_groups
    where lower(name) = lower(cleaned_name)
      and (target_id is null or id <> target_id)
  ) then
    raise exception 'Группа с таким названием уже есть.';
  end if;

  if target_id is null then
    select coalesce(max(sort_order), -1) + 1
      into next_order
    from public.device_compatible_part_groups;

    insert into public.device_compatible_part_groups (name, color, sort_order, created_by)
    values (cleaned_name, cleaned_color, next_order, auth.uid())
    returning id into result_id;
  else
    update public.device_compatible_part_groups
    set name = cleaned_name,
        color = cleaned_color
    where id = target_id
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
    raise exception 'Сначала уберите детали из группы на карточках приборов.';
  end if;

  delete from public.device_compatible_part_groups where id = target_id;
end;
$$;

create or replace function public.reorder_device_compatible_part_groups(group_ids uuid[])
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

  select count(*) into expected_count from public.device_compatible_part_groups;

  select count(*) into matched_count
  from public.device_compatible_part_groups
  where id = any (group_ids);

  if expected_count <> array_length(group_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все группы.';
  end if;

  update public.device_compatible_part_groups g
  set sort_order = o.ord - 1
  from unnest(group_ids) with ordinality as o(id, ord)
  where g.id = o.id;
end;
$$;

-- Порядок деталей — только внутри вида прибора + группы.
create or replace function public.reorder_device_compatible_parts(
  target_reference_item_id uuid,
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

  if target_reference_item_id is null or not exists (
    select 1 from public.reference_items where id = target_reference_item_id
  ) then
    raise exception 'Вид прибора не найден.';
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
  where reference_item_id = target_reference_item_id
    and group_id = target_group_id;

  select count(*) into matched_count
  from public.device_compatible_parts
  where reference_item_id = target_reference_item_id
    and group_id = target_group_id
    and id = any (link_ids);

  if expected_count <> array_length(link_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все детали группы на этой карточке.';
  end if;

  update public.device_compatible_parts p
  set sort_order = o.ord - 1
  from unnest(link_ids) with ordinality as o(id, ord)
  where p.id = o.id
    and p.reference_item_id = target_reference_item_id
    and p.group_id = target_group_id;
end;
$$;

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
    order by g.sort_order, g.created_at
    limit 1;

    if resolved_group_id is null then
      insert into public.device_compatible_part_groups (name, color, sort_order, created_by)
      values ('Основные', '#2563eb', 0, auth.uid())
      returning id into resolved_group_id;
    end if;
  elsif not exists (
    select 1 from public.device_compatible_part_groups where id = resolved_group_id
  ) then
    raise exception 'Группа не найдена.';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into next_order
  from public.device_compatible_parts
  where reference_item_id = target_reference_item_id
    and group_id = resolved_group_id;

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
revoke all on function public.upsert_device_compatible_part_group(uuid, text, text) from public, anon;
revoke all on function public.delete_device_compatible_part_group(uuid) from public, anon;
revoke all on function public.reorder_device_compatible_part_groups(uuid[]) from public, anon;
revoke all on function public.reorder_device_compatible_parts(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.add_device_compatible_part(uuid, uuid, uuid) from public, anon;

grant execute on function public.list_device_compatible_part_groups(uuid) to authenticated;
grant execute on function public.upsert_device_compatible_part_group(uuid, text, text) to authenticated;
grant execute on function public.delete_device_compatible_part_group(uuid) to authenticated;
grant execute on function public.reorder_device_compatible_part_groups(uuid[]) to authenticated;
grant execute on function public.reorder_device_compatible_parts(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.add_device_compatible_part(uuid, uuid, uuid) to authenticated;
