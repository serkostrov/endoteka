-- Диагностика: протокол без заключения и инженера. Дата обновляется при каждом сохранении.

create or replace function public.save_order_diagnostics(
  target_order_id uuid,
  conclusion text default null,
  target_engineer_id uuid default null,
  field_values jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was_new boolean;
  old_fields jsonb := '{}'::jsonb;
  changes jsonb := '[]'::jsonb;
  field_row record;
  old_value jsonb;
  new_value jsonb;
begin
  if not public.has_permission('diagnostics:update') then
    raise exception 'Недостаточно прав для записи диагностики.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  was_new := not exists (select 1 from public.order_diagnostics where order_id = target_order_id);

  if not was_new then
    select coalesce(jsonb_object_agg(f.code, v.value), '{}'::jsonb)
      into old_fields
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id and v.record_id = target_order_id
    where f.entity_code = 'diagnostics';
  end if;

  insert into public.order_diagnostics (
    order_id, conclusion, engineer_id, created_by, updated_by, created_at, updated_at
  )
  values (
    target_order_id, '', null, auth.uid(), auth.uid(), now(), now()
  )
  on conflict (order_id) do update
    set updated_by = excluded.updated_by,
        updated_at = now();

  perform public.save_dynamic_field_values('diagnostics', target_order_id, coalesce(field_values, '{}'::jsonb));

  for field_row in
    select f.code, f.name
    from public.dynamic_fields f
    where f.entity_code = 'diagnostics' and f.is_active = true
    order by f.sort_order, f.name
  loop
    old_value := old_fields -> field_row.code;
    new_value := coalesce(field_values, '{}'::jsonb) -> field_row.code;
    if old_value = 'null'::jsonb then
      old_value := null;
    end if;
    if new_value = 'null'::jsonb or (jsonb_typeof(new_value) = 'string' and btrim(new_value #>> '{}') = '') then
      new_value := null;
    end if;
    if old_value is distinct from new_value then
      changes := changes || jsonb_build_array(jsonb_build_object(
        'field', field_row.code,
        'label', field_row.name,
        'from', old_value,
        'to', new_value
      ));
    end if;
  end loop;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    case when was_new then 'diagnostics_created' else 'diagnostics_updated' end,
    auth.uid(),
    case when was_new then 'Создана диагностика' else 'Обновлена диагностика' end,
    jsonb_build_object('changes', changes)
  );

  perform public.record_audit(
    case when was_new then 'orders.diagnostics_created' else 'orders.diagnostics_updated' end,
    'order',
    target_order_id::text,
    jsonb_build_object('changes', changes)
  );
end;
$$;

create or replace function public.transition_rule_passed(rule_code text, target_order public.orders)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if rule_code = 'diagnostics_conclusion' then
    return exists (
      select 1 from public.order_diagnostics d
      where d.order_id = target_order.id
    );
  end if;

  if rule_code = 'responsible_assigned' then
    return target_order.responsible_id is not null;
  end if;

  return false;
end;
$$;

update public.transition_rule_types
set
  name = 'Протокол диагностики',
  description = 'Нужен сохранённый протокол диагностики'
where code = 'diagnostics_conclusion';
