-- Совместимые детали номенклатуры для видов приборов (модель / модификация и др.).

create table if not exists public.device_compatible_parts (
  id uuid primary key default gen_random_uuid(),
  reference_item_id uuid not null references public.reference_items (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint device_compatible_parts_unique unique (reference_item_id, item_id)
);

create index if not exists device_compatible_parts_reference_idx
  on public.device_compatible_parts (reference_item_id, sort_order, created_at);

create index if not exists device_compatible_parts_item_idx
  on public.device_compatible_parts (item_id);

alter table public.device_compatible_parts enable row level security;

drop policy if exists device_compatible_parts_select on public.device_compatible_parts;
create policy device_compatible_parts_select
  on public.device_compatible_parts
  for select
  to authenticated
  using (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  );

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
    link.sort_order,
    link.created_at
  from public.device_compatible_parts link
  join public.inventory_items i on i.id = link.item_id
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where link.reference_item_id = target_reference_item_id
  order by link.sort_order, i.name, link.created_at;
end;
$$;

create or replace function public.add_device_compatible_part(
  target_reference_item_id uuid,
  target_item_id uuid
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

  select coalesce(max(sort_order), 0) + 1
    into next_order
  from public.device_compatible_parts
  where reference_item_id = target_reference_item_id;

  insert into public.device_compatible_parts (
    reference_item_id, item_id, sort_order, created_by
  )
  values (
    target_reference_item_id, target_item_id, next_order, auth.uid()
  )
  on conflict (reference_item_id, item_id) do update
    set sort_order = public.device_compatible_parts.sort_order
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.remove_device_compatible_part(
  target_reference_item_id uuid,
  target_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения подходящих деталей.';
  end if;

  delete from public.device_compatible_parts
  where reference_item_id = target_reference_item_id
    and item_id = target_item_id;

  if not found then
    raise exception 'Связь с деталью не найдена.';
  end if;
end;
$$;

revoke all on function public.list_device_compatible_parts(uuid) from public, anon;
revoke all on function public.add_device_compatible_part(uuid, uuid) from public, anon;
revoke all on function public.remove_device_compatible_part(uuid, uuid) from public, anon;

grant execute on function public.list_device_compatible_parts(uuid) to authenticated;
grant execute on function public.add_device_compatible_part(uuid, uuid) to authenticated;
grant execute on function public.remove_device_compatible_part(uuid, uuid) to authenticated;
