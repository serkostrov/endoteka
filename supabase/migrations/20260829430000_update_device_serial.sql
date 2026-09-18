-- Разрешить смену серийного номера прибора при обновлении карточки.

drop function if exists public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb);

create or replace function public.update_device(
  target_device_id uuid,
  device_group_id uuid default null,
  device_brand_id uuid default null,
  device_model_id uuid default null,
  device_modification_id uuid default null,
  device_metadata jsonb default null,
  device_serial text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_serial text;
  next_serial text;
  conflict_id uuid;
begin
  if not public.has_permission('devices:update') then
    raise exception 'Недостаточно прав для изменения прибора.';
  end if;

  select serial_number into current_serial
  from public.devices
  where id = target_device_id;

  if current_serial is null then
    raise exception 'Прибор не найден.';
  end if;

  perform public.assert_device_classification(
    device_group_id, device_brand_id, device_model_id, device_modification_id
  );

  if device_serial is null then
    next_serial := current_serial;
  else
    next_serial := btrim(device_serial);
    if char_length(next_serial) < 1 then
      raise exception 'Укажите серийный номер.';
    end if;
  end if;

  if lower(next_serial) is distinct from lower(btrim(current_serial)) then
    select id into conflict_id
    from public.devices
    where id is distinct from target_device_id
      and lower(btrim(serial_number)) = lower(next_serial)
    limit 1;

    if conflict_id is not null then
      raise exception 'Прибор с таким серийным номером уже существует'
        using hint = conflict_id::text;
    end if;
  end if;

  update public.devices
  set
    serial_number = next_serial,
    group_id = device_group_id,
    brand_id = device_brand_id,
    model_id = device_model_id,
    modification_id = device_modification_id,
    metadata = coalesce(device_metadata, metadata)
  where id = target_device_id;

  if next_serial is distinct from current_serial then
    update public.orders
    set serial_number = next_serial
    where device_id = target_device_id
      and serial_number is distinct from next_serial;
  end if;

  perform public.record_audit(
    'devices.updated',
    'device',
    target_device_id::text,
    jsonb_build_object(
      'serial_number', next_serial,
      'previous_serial_number', current_serial
    )
  );
end;
$$;

revoke all on function public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb, text) from public;
grant execute on function public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
