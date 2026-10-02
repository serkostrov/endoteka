-- Обратная выборка: подходящие виды приборов для позиции номенклатуры.
-- Та же таблица device_compatible_parts — синхронизация с карточкой вида.

create or replace function public.list_inventory_item_compatible_types(target_item_id uuid)
returns table (
  id uuid,
  code text,
  name text,
  set_code text,
  set_name text,
  path_label text,
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
    raise exception 'Недостаточно прав для просмотра подходящих приборов.';
  end if;

  if target_item_id is null then
    raise exception 'Не указана позиция номенклатуры.';
  end if;

  return query
  select
    ri.id,
    ri.code,
    ri.name,
    rs.code::text as set_code,
    rs.name::text as set_name,
    case rs.code
      when 'device_modifications' then
        concat_ws(' · ', nullif(btrim(great.name), ''), nullif(btrim(grand.name), ''), nullif(btrim(parent.name), ''), ri.name)
      when 'device_models' then
        concat_ws(' · ', nullif(btrim(grand.name), ''), nullif(btrim(parent.name), ''), ri.name)
      when 'device_brands' then
        concat_ws(' · ', nullif(btrim(parent.name), ''), ri.name)
      else ri.name
    end as path_label,
    (
      select p.file_path
      from public.reference_item_photos p
      where p.reference_item_id = ri.id
      order by p.sort_order, p.created_at
      limit 1
    ) as cover_file_path,
    link.id as link_id,
    link.sort_order,
    link.created_at
  from public.device_compatible_parts link
  join public.reference_items ri on ri.id = link.reference_item_id
  join public.reference_sets rs on rs.id = ri.set_id
  left join public.reference_items parent on parent.id = ri.parent_id
  left join public.reference_items grand on grand.id = parent.parent_id
  left join public.reference_items great on great.id = grand.parent_id
  where link.item_id = target_item_id
  order by link.sort_order, ri.name, link.created_at;
end;
$$;

revoke all on function public.list_inventory_item_compatible_types(uuid) from public, anon;
grant execute on function public.list_inventory_item_compatible_types(uuid) to authenticated;
