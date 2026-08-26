-- Удаление записей справочников, доп. полей и переходов статусов.

create or replace function public.reference_item_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    (select count(*) from public.reference_items where parent_id = target_item_id) +
    (select count(*) from public.orders where status_id = target_item_id) +
    (select count(*) from public.devices where group_id = target_item_id or brand_id = target_item_id or model_id = target_item_id or modification_id = target_item_id) +
    (select count(*) from public.inventory_items where category_id = target_item_id or unit_id = target_item_id) +
    (select count(*) from public.order_status_transitions where from_status_id = target_item_id or to_status_id = target_item_id)
  )::integer;
$$;

create or replace function public.delete_reference_item(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
  usage_count integer;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Запись справочника не найдена.';
  end if;

  if current_row.is_system then
    raise exception 'Системную запись удалить нельзя.';
  end if;

  usage_count := public.reference_item_usage_count(target_id);
  if usage_count > 0 then
    raise exception 'Запись используется и не может быть удалена. Скройте её, чтобы не показывать в списках.';
  end if;

  delete from public.reference_items where id = target_id;

  perform public.record_audit(
    'references.item_deleted',
    'reference_item',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'set_id', current_row.set_id, 'name', current_row.name)
  );
end;
$$;

create or replace function public.delete_dynamic_field(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.dynamic_fields%rowtype;
begin
  perform public.assert_settings_write();

  select * into current_row from public.dynamic_fields where id = target_id;
  if current_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  delete from public.dynamic_field_values where field_id = target_id;
  delete from public.dynamic_fields where id = target_id;

  perform public.record_audit(
    'fields.deleted',
    'dynamic_field',
    target_id::text,
    jsonb_build_object('entity_code', current_row.entity_code, 'code', current_row.code, 'name', current_row.name)
  );
end;
$$;

create or replace function public.delete_order_transition(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_status_transitions%rowtype;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения маршрута.';
  end if;

  select * into current_row from public.order_status_transitions where id = target_id;
  if current_row.id is null then
    raise exception 'Переход не найден.';
  end if;

  delete from public.order_status_transitions where id = target_id;

  perform public.record_audit(
    'orders.transition_deleted',
    'order_transition',
    target_id::text,
    jsonb_build_object('from_status_id', current_row.from_status_id, 'to_status_id', current_row.to_status_id)
  );
end;
$$;

revoke all on function public.delete_reference_item(uuid) from public;
revoke all on function public.delete_dynamic_field(uuid) from public;
revoke all on function public.delete_order_transition(uuid) from public;

grant execute on function public.delete_reference_item(uuid) to authenticated;
grant execute on function public.delete_dynamic_field(uuid) to authenticated;
grant execute on function public.delete_order_transition(uuid) to authenticated;
