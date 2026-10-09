-- Сохранение полей order_work / доп. полей orders → запись в историю заказа.

create or replace function public.save_dynamic_field_values(
  target_entity_code text,
  target_record_id uuid,
  field_values jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  field_row public.dynamic_fields%rowtype;
  raw jsonb;
  permission_code text;
  journal_enabled boolean := false;
  old_fields jsonb := '{}'::jsonb;
  changes jsonb := '[]'::jsonb;
  old_value jsonb;
  new_value jsonb;
  summary_text text;
begin
  if not public.is_active_user() then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.field_entities where code = target_entity_code) then
    raise exception 'Раздел карточки не найден.';
  end if;

  permission_code := target_entity_code || ':update';
  if target_entity_code = 'diagnostics' then
    permission_code := 'diagnostics:update';
  elsif target_entity_code = 'inventory' then
    permission_code := 'inventory:receive';
  elsif target_entity_code = 'order_work' then
    permission_code := 'orders:update';
  elsif target_entity_code = 'devices' then
    if not (
      public.has_permission('devices:update')
      or public.has_permission('settings:update')
    ) then
      raise exception 'Недостаточно прав для сохранения полей.';
    end if;
    permission_code := null;
  end if;

  if permission_code is not null and not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
  end if;

  journal_enabled :=
    target_entity_code in ('order_work', 'orders')
    and exists (select 1 from public.orders where id = target_record_id);

  if journal_enabled then
    select coalesce(jsonb_object_agg(f.code, v.value), '{}'::jsonb)
      into old_fields
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id and v.record_id = target_record_id
    where f.entity_code = target_entity_code
      and f.is_active = true
      and not public.is_order_card_field(f.entity_code, f.code);
  end if;

  for field_row in
    select *
    from public.dynamic_fields
    where entity_code = target_entity_code
      and is_active = true
  loop
    if public.is_order_card_field(field_row.entity_code, field_row.code) then
      continue;
    end if;

    raw := field_values -> field_row.code;
    perform public.validate_dynamic_field_value(field_row.id, raw);

    if raw is null or raw = 'null'::jsonb or (jsonb_typeof(raw) = 'string' and btrim(raw #>> '{}') = '') then
      delete from public.dynamic_field_values
      where field_id = field_row.id
        and record_id = target_record_id;
      new_value := null;
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
      new_value := raw;
    end if;

    if journal_enabled then
      old_value := old_fields -> field_row.code;
      if old_value = 'null'::jsonb then
        old_value := null;
      end if;
      if old_value is not null
        and jsonb_typeof(old_value) = 'string'
        and btrim(old_value #>> '{}') = ''
      then
        old_value := null;
      end if;

      if old_value is distinct from new_value then
        changes := changes || jsonb_build_array(jsonb_build_object(
          'field', field_row.code,
          'label', field_row.name,
          'from', old_value,
          'to', new_value
        ));
      end if;
    end if;
  end loop;

  if journal_enabled and jsonb_array_length(changes) > 0 then
    summary_text := case
      when target_entity_code = 'order_work' then 'Изменены поля состава работы'
      else 'Изменения в заказе'
    end;

    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      target_record_id,
      'order_updated',
      auth.uid(),
      summary_text,
      jsonb_build_object('changes', changes)
    );

    perform public.record_audit(
      'orders.updated',
      'order',
      target_record_id::text,
      jsonb_build_object(
        'entity_code', target_entity_code,
        'changes', changes
      )
    );
  end if;
end;
$$;

revoke all on function public.save_dynamic_field_values(text, uuid, jsonb) from public, anon;
grant execute on function public.save_dynamic_field_values(text, uuid, jsonb) to authenticated;
