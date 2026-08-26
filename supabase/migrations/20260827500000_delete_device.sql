-- Удаление прибора, если по нему ещё нет заказов.

create or replace function public.delete_device(target_device_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.devices%rowtype;
begin
  if not public.has_permission('devices:delete') then
    raise exception 'Недостаточно прав для удаления прибора.';
  end if;

  select * into current_row
  from public.devices
  where id = target_device_id
  for update;

  if current_row.id is null then
    raise exception 'Прибор не найден.';
  end if;

  if exists (select 1 from public.orders where device_id = target_device_id) then
    raise exception 'Прибор нельзя удалить: по нему есть заказы.';
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'devices' and record_id = target_device_id;

  delete from public.devices
  where id = target_device_id;

  perform public.record_audit(
    'devices.deleted',
    'device',
    target_device_id::text,
    jsonb_build_object('serial_number', current_row.serial_number)
  );
end;
$$;

revoke all on function public.delete_device(uuid) from public;
grant execute on function public.delete_device(uuid) to authenticated;
