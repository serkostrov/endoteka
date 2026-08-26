-- Удаление позиции склада, если по ней нет партий, движений и документов.

create or replace function public.delete_inventory_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_items%rowtype;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления номенклатуры.';
  end if;

  select * into current_row
  from public.inventory_items
  where id = target_item_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция не найдена.';
  end if;

  if exists (select 1 from public.inventory_batches where item_id = target_item_id)
    or exists (select 1 from public.inventory_movements where item_id = target_item_id)
    or exists (select 1 from public.sale_lines where item_id = target_item_id)
    or exists (select 1 from public.inventory_count_lines where item_id = target_item_id)
    or exists (select 1 from public.documents where source_type = 'item' and source_id = target_item_id)
  then
    raise exception 'Позицию нельзя удалить: по ней есть партии, движения или документы.';
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'inventory' and record_id = target_item_id;

  delete from public.inventory_items
  where id = target_item_id;

  perform public.record_audit(
    'inventory.item_deleted',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', current_row.name, 'code', current_row.code)
  );
end;
$$;

revoke all on function public.delete_inventory_item(uuid) from public;
grant execute on function public.delete_inventory_item(uuid) to authenticated;
