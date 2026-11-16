-- Сборка: заключение из поля диагностики «Заключение» (zaklyuchenie),
-- с запасным чтением legacy-колонки order_diagnostics.conclusion.
-- Разовая синхронизация обоих хранилищ по order_id (один номер заказа = одна сущность).

-- -----------------------------------------------------------------------------
-- Helper: актуальный текст заключения диагностики
-- -----------------------------------------------------------------------------

create or replace function public.order_diagnostics_conclusion(target_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(
      btrim(
        coalesce(
          (
            select case
              when v.value is null or v.value = 'null'::jsonb then ''
              when jsonb_typeof(v.value) = 'string' then coalesce(v.value #>> '{}', '')
              else coalesce(v.value::text, '')
            end
            from public.dynamic_fields f
            left join public.dynamic_field_values v
              on v.field_id = f.id
             and v.record_id = target_order_id
            where f.entity_code = 'diagnostics'
              and f.code = 'zaklyuchenie'
            limit 1
          ),
          ''
        )
      ),
      ''
    ),
    nullif(btrim(coalesce((
      select d.conclusion
      from public.order_diagnostics d
      where d.order_id = target_order_id
    ), '')), ''),
    ''
  );
$$;

revoke all on function public.order_diagnostics_conclusion(uuid) from public, anon;
grant execute on function public.order_diagnostics_conclusion(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- get_order_assembly: заключение из поля вкладки «Диагностика»
-- -----------------------------------------------------------------------------

create or replace function public.get_order_assembly(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав.';
  end if;

  select jsonb_build_object(
    'id', o.id,
    'number', o.number,
    'customer_id', o.customer_id,
    'customer_name', o.customer_name,
    'device_id', o.device_id,
    'serial_number', o.serial_number,
    'device_label', o.device_label,
    'device_brand', o.device_brand,
    'device_model', o.device_model,
    'status_id', o.status_id,
    'status_code', o.status_code,
    'status_name', o.status_name,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'conclusion', public.order_diagnostics_conclusion(o.id),
    'completeness_pct', coalesce(public.order_assembly_completeness(o.id), 0),
    'parts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'qty_required', p.qty_required,
          'qty_collected', p.qty_collected,
          'comment', p.comment,
          'sort_order', p.sort_order,
          'created_at', p.created_at,
          'updated_at', p.updated_at
        )
        order by p.sort_order, p.created_at, p.id
      )
      from public.order_assembly_parts p
      where p.order_id = o.id
    ), '[]'::jsonb)
  )
  into payload
  from public.order_list_items o
  where o.id = target_order_id;

  if payload is null then
    raise exception 'Заказ не найден.';
  end if;

  return payload;
end;
$$;

-- -----------------------------------------------------------------------------
-- save_order_diagnostics: колонка conclusion зеркалит поле zaklyuchenie
-- -----------------------------------------------------------------------------

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
  next_conclusion text := '';
  raw_conclusion jsonb;
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

  raw_conclusion := coalesce(field_values, '{}'::jsonb) -> 'zaklyuchenie';
  if raw_conclusion is not null
     and raw_conclusion <> 'null'::jsonb
     and jsonb_typeof(raw_conclusion) = 'string' then
    next_conclusion := btrim(coalesce(raw_conclusion #>> '{}', ''));
  elsif conclusion is not null then
    next_conclusion := btrim(conclusion);
  end if;

  insert into public.order_diagnostics (
    order_id, conclusion, engineer_id, created_by, updated_by, created_at, updated_at
  )
  values (
    target_order_id, next_conclusion, null, auth.uid(), auth.uid(), now(), now()
  )
  on conflict (order_id) do update
    set conclusion = excluded.conclusion,
        updated_by = excluded.updated_by,
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

-- -----------------------------------------------------------------------------
-- Data sync: колонка ↔ поле zaklyuchenie (по одному order_id / номеру заказа)
-- -----------------------------------------------------------------------------

-- 1) Колонка → поле: если в вкладке диагностики пусто, а в order_diagnostics есть текст.
insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
select
  f.id,
  'diagnostics',
  d.order_id,
  to_jsonb(btrim(d.conclusion))
from public.order_diagnostics d
join public.dynamic_fields f
  on f.entity_code = 'diagnostics'
 and f.code = 'zaklyuchenie'
where btrim(coalesce(d.conclusion, '')) <> ''
  and not exists (
    select 1
    from public.dynamic_field_values v
    where v.field_id = f.id
      and v.record_id = d.order_id
      and v.value is not null
      and v.value <> 'null'::jsonb
      and btrim(coalesce(v.value #>> '{}', '')) <> ''
  )
on conflict (field_id, record_id) do update
  set value = excluded.value,
      updated_at = now()
where btrim(coalesce(public.dynamic_field_values.value #>> '{}', '')) = ''
   or public.dynamic_field_values.value is null
   or public.dynamic_field_values.value = 'null'::jsonb;

-- 2) Поле → колонка: если колонка пуста, а поле заполнено.
update public.order_diagnostics d
set conclusion = src.field_text,
    updated_at = now()
from (
  select
    v.record_id as order_id,
    btrim(coalesce(v.value #>> '{}', '')) as field_text
  from public.dynamic_field_values v
  join public.dynamic_fields f on f.id = v.field_id
  where f.entity_code = 'diagnostics'
    and f.code = 'zaklyuchenie'
    and v.value is not null
    and v.value <> 'null'::jsonb
    and btrim(coalesce(v.value #>> '{}', '')) <> ''
) src
where d.order_id = src.order_id
  and btrim(coalesce(d.conclusion, '')) = '';

-- 3) Есть поле, но нет строки order_diagnostics — создаём протокол с заключением.
insert into public.order_diagnostics (order_id, conclusion, created_at, updated_at)
select
  v.record_id,
  btrim(coalesce(v.value #>> '{}', '')),
  now(),
  now()
from public.dynamic_field_values v
join public.dynamic_fields f on f.id = v.field_id
where f.entity_code = 'diagnostics'
  and f.code = 'zaklyuchenie'
  and v.value is not null
  and v.value <> 'null'::jsonb
  and btrim(coalesce(v.value #>> '{}', '')) <> ''
  and not exists (
    select 1 from public.order_diagnostics d where d.order_id = v.record_id
  )
on conflict (order_id) do nothing;

-- 4) Оба заполнены, но отличаются: берём более полный текст в оба хранилища.
with mismatch as (
  select
    d.order_id,
    f.id as field_id,
    case
      when length(btrim(d.conclusion)) >= length(btrim(coalesce(v.value #>> '{}', '')))
        then btrim(d.conclusion)
      else btrim(coalesce(v.value #>> '{}', ''))
    end as best
  from public.order_diagnostics d
  join public.dynamic_fields f
    on f.entity_code = 'diagnostics'
   and f.code = 'zaklyuchenie'
  join public.dynamic_field_values v
    on v.field_id = f.id
   and v.record_id = d.order_id
  where btrim(coalesce(d.conclusion, '')) <> ''
    and btrim(coalesce(d.conclusion, ''))
      is distinct from btrim(coalesce(v.value #>> '{}', ''))
)
update public.order_diagnostics d
set conclusion = m.best,
    updated_at = now()
from mismatch m
where d.order_id = m.order_id
  and btrim(coalesce(d.conclusion, '')) is distinct from m.best;

with mismatch as (
  select
    d.order_id,
    f.id as field_id,
    case
      when length(btrim(d.conclusion)) >= length(btrim(coalesce(v.value #>> '{}', '')))
        then btrim(d.conclusion)
      else btrim(coalesce(v.value #>> '{}', ''))
    end as best
  from public.order_diagnostics d
  join public.dynamic_fields f
    on f.entity_code = 'diagnostics'
   and f.code = 'zaklyuchenie'
  join public.dynamic_field_values v
    on v.field_id = f.id
   and v.record_id = d.order_id
  where btrim(coalesce(d.conclusion, '')) <> ''
    and btrim(coalesce(d.conclusion, ''))
      is distinct from btrim(coalesce(v.value #>> '{}', ''))
)
update public.dynamic_field_values v
set value = to_jsonb(m.best),
    updated_at = now()
from mismatch m
where v.field_id = m.field_id
  and v.record_id = m.order_id
  and btrim(coalesce(v.value #>> '{}', '')) is distinct from m.best;

notify pgrst, 'reload schema';
