-- Диагностика заказа: инженер, журнал, группы полей, единое сохранение.

alter table public.dynamic_fields
  add column if not exists group_name text not null default '';

alter table public.order_diagnostics
  add column if not exists engineer_id uuid references public.profiles (id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

update public.order_diagnostics
set created_by = coalesce(created_by, updated_by)
where created_by is null;

create table if not exists public.order_journal_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_journal_events_order_idx
  on public.order_journal_events (order_id, created_at desc);

create or replace function public.forbid_order_journal_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Записи журнала нельзя изменять.';
end;
$$;

drop trigger if exists order_journal_events_no_update on public.order_journal_events;
create trigger order_journal_events_no_update
  before update or delete on public.order_journal_events
  for each row execute procedure public.forbid_order_journal_mutation();

create or replace view public.order_diagnostics_items
with (security_invoker = true) as
select
  d.order_id,
  d.engineer_id,
  coalesce(eng.full_name, eng.email, '') as engineer_name,
  d.conclusion,
  d.created_at,
  d.created_by,
  d.updated_at,
  d.updated_by,
  coalesce(upd.full_name, upd.email, '') as updated_by_name
from public.order_diagnostics d
left join public.profiles eng on eng.id = d.engineer_id
left join public.profiles upd on upd.id = d.updated_by;

update public.dynamic_fields
set group_name = 'Осмотр'
where entity_code = 'diagnostics' and code = 'leak_test' and group_name = '';

update public.dynamic_fields
set group_name = 'Измерения'
where entity_code = 'diagnostics' and code = 'working_hours' and group_name = '';

update public.dynamic_fields
set group_name = 'Комментарии'
where entity_code = 'diagnostics' and code = 'notes' and group_name = '';

insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
values
  ('diagnostics', 'bending_section', 'Состояние изгибателя', 'select', false, 3, 'Осмотр'),
  ('diagnostics', 'insertion_tube', 'Введенная трубка', 'select', false, 4, 'Осмотр'),
  ('diagnostics', 'image_quality', 'Качество изображения', 'select', false, 5, 'Изображение'),
  ('diagnostics', 'light_output', 'Свет', 'select', false, 6, 'Изображение')
on conflict do nothing;

insert into public.dynamic_field_options (field_id, code, label, sort_order)
select f.id, o.code, o.label, o.sort_order
from public.dynamic_fields f
join (
  values
    ('bending_section', 'ok', 'В норме', 0),
    ('bending_section', 'stiff', 'Тугой ход', 1),
    ('bending_section', 'defect', 'Дефект', 2),
    ('insertion_tube', 'ok', 'В норме', 0),
    ('insertion_tube', 'scratches', 'Царапины', 1),
    ('insertion_tube', 'damage', 'Повреждение', 2),
    ('image_quality', 'good', 'Хорошее', 0),
    ('image_quality', 'noise', 'Помехи', 1),
    ('image_quality', 'no_image', 'Нет изображения', 2),
    ('light_output', 'normal', 'Нормальный', 0),
    ('light_output', 'dim', 'Слабый', 1),
    ('light_output', 'none', 'Нет света', 2)
) as o(field_code, code, label, sort_order) on true
where f.entity_code = 'diagnostics' and f.code = o.field_code
on conflict do nothing;

drop function if exists public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb);

create function public.upsert_dynamic_field(
  target_id uuid,
  entity_code text,
  field_code text,
  field_name text,
  field_type text,
  is_required boolean default false,
  options jsonb default '[]'::jsonb,
  group_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p_entity text := entity_code;
  p_type text := field_type;
  p_required boolean := coalesce(is_required, false);
  p_options jsonb := coalesce(options, '[]'::jsonb);
  normalized_code text;
  normalized_name text;
  normalized_group text;
  current_row public.dynamic_fields%rowtype;
  result_id uuid;
  next_sort integer;
  usage_count integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.field_entities where code = p_entity) then
    raise exception 'Раздел карточки не найден.';
  end if;

  if not exists (select 1 from public.dynamic_field_types where code = p_type) then
    raise exception 'Неизвестный тип поля.';
  end if;

  normalized_code := lower(btrim(coalesce(field_code, '')));
  normalized_name := btrim(coalesce(field_name, ''));
  normalized_group := left(btrim(coalesce(group_name, '')), 80);

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if p_type = 'select' and (jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 1) then
    raise exception 'Для списка добавьте хотя бы один вариант.';
  end if;

  if target_id is not null then
    select * into current_row from public.dynamic_fields where id = target_id and dynamic_fields.entity_code = p_entity;
    if current_row.id is null then
      raise exception 'Поле не найдено.';
    end if;

    usage_count := public.dynamic_field_usage_count(current_row.id);
    if usage_count > 0 and current_row.field_type <> p_type then
      raise exception 'Нельзя сменить тип поля, которое уже используется в данных.';
    end if;

    if current_row.code <> normalized_code and usage_count > 0 then
      raise exception 'Нельзя сменить код поля, которое уже используется в данных.';
    end if;

    update public.dynamic_fields
    set
      code = case when usage_count > 0 then current_row.code else normalized_code end,
      name = normalized_name,
      field_type = p_type,
      is_required = p_required,
      group_name = normalized_group
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.dynamic_fields
    where dynamic_fields.entity_code = p_entity;

    insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
    values (
      p_entity,
      normalized_code,
      normalized_name,
      p_type,
      p_required,
      next_sort,
      normalized_group
    )
    returning id into result_id;
  end if;

  if p_type = 'select' then
    perform public.replace_dynamic_field_options(result_id, p_options);
    if not exists (
      select 1 from public.dynamic_field_options
      where field_id = result_id and is_active = true
    ) then
      raise exception 'Для списка добавьте хотя бы один активный вариант.';
    end if;
  else
    update public.dynamic_field_options
    set is_active = false
    where field_id = result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'fields.created' else 'fields.updated' end,
    'dynamic_field',
    result_id::text,
    jsonb_build_object('entity_code', p_entity, 'code', normalized_code, 'field_type', p_type)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Поле с таким кодом уже есть в этом разделе.';
end;
$$;

create or replace function public.get_available_order_transitions(target_order_id uuid)
returns table (
  transition_id uuid,
  to_status_id uuid,
  to_status_code text,
  to_status_name text,
  required_permission text,
  is_allowed boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  rec record;
  allowed boolean;
  reason text;
  rule_code text;
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав.';
  end if;

  select * into current_row from public.orders where id = target_order_id;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  for rec in
    select tr.id, tr.to_status_id, tr.required_permission, i.code, i.name
    from public.order_status_transitions tr
    join public.reference_items i on i.id = tr.to_status_id
    where tr.from_status_id = current_row.status_id
      and tr.is_active = true
    order by tr.sort_order, i.sort_order
  loop
    allowed := public.has_permission(rec.required_permission);
    reason := null;

    if not allowed then
      reason := 'Недостаточно прав для этого перехода.';
    else
      for rule_code in
        select r.rule_code from public.order_transition_rules r where r.transition_id = rec.id
      loop
        if not public.transition_rule_passed(rule_code, current_row) then
          allowed := false;
          if rule_code = 'diagnostics_conclusion' then
            reason := 'Сначала заполните заключение диагностики.';
          elsif rule_code = 'responsible_assigned' then
            reason := 'Назначьте ответственного сотрудника.';
          else
            reason := 'Не выполнено условие перехода.';
          end if;
          exit;
        end if;
      end loop;
    end if;

    transition_id := rec.id;
    to_status_id := rec.to_status_id;
    to_status_code := rec.code;
    to_status_name := rec.name;
    required_permission := rec.required_permission;
    is_allowed := allowed;
    block_reason := reason;
    return next;
  end loop;
end;
$$;

drop function if exists public.save_order_diagnostics(uuid, text);

create function public.save_order_diagnostics(
  target_order_id uuid,
  conclusion text,
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
  old_conclusion text := '';
  old_engineer uuid;
  old_fields jsonb := '{}'::jsonb;
  new_conclusion text;
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

  if target_engineer_id is not null and not exists (
    select 1 from public.profiles where id = target_engineer_id and is_active = true
  ) then
    raise exception 'Выберите действующего инженера.';
  end if;

  new_conclusion := btrim(coalesce(conclusion, ''));
  was_new := not exists (select 1 from public.order_diagnostics where order_id = target_order_id);

  if not was_new then
    select d.conclusion, d.engineer_id
      into old_conclusion, old_engineer
    from public.order_diagnostics d
    where d.order_id = target_order_id;

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
    target_order_id, new_conclusion, target_engineer_id, auth.uid(), auth.uid(), now(), now()
  )
  on conflict (order_id) do update
    set conclusion = excluded.conclusion,
        engineer_id = excluded.engineer_id,
        updated_by = excluded.updated_by,
        updated_at = now();

  perform public.save_dynamic_field_values('diagnostics', target_order_id, coalesce(field_values, '{}'::jsonb));

  if coalesce(old_conclusion, '') is distinct from new_conclusion then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'conclusion',
      'label', 'Заключение',
      'from', left(coalesce(old_conclusion, ''), 200),
      'to', left(new_conclusion, 200)
    ));
  end if;

  if old_engineer is distinct from target_engineer_id then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'engineer_id',
      'label', 'Инженер',
      'from', (select coalesce(full_name, email, '') from public.profiles where id = old_engineer),
      'to', (select coalesce(full_name, email, '') from public.profiles where id = target_engineer_id)
    ));
  end if;

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

create or replace function public.get_order_journal(target_order_id uuid)
returns table (
  id uuid,
  event_type text,
  summary text,
  actor_id uuid,
  actor_name text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission('orders:read') or public.has_permission('diagnostics:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  return query
  select *
  from (
    select
      e.id,
      e.event_type,
      e.summary,
      e.actor_id,
      coalesce(p.full_name, p.email, '') as actor_name,
      e.payload,
      e.created_at
    from public.order_journal_events e
    left join public.profiles p on p.id = e.actor_id
    where e.order_id = target_order_id

    union all

    select
      s.id,
      'status_changed'::text,
      case
        when s.from_status_id is null then coalesce(s.metadata ->> 'to_name', t.name)
        else coalesce(s.metadata ->> 'from_name', f.name, '') || ' → ' || coalesce(s.metadata ->> 'to_name', t.name)
      end,
      s.actor_id,
      coalesce(ap.full_name, ap.email, ''),
      s.metadata,
      s.created_at
    from public.order_status_events s
    left join public.reference_items f on f.id = s.from_status_id
    left join public.reference_items t on t.id = s.to_status_id
    left join public.profiles ap on ap.id = s.actor_id
    where s.order_id = target_order_id
  ) events
  order by events.created_at desc, events.id desc;
end;
$$;

alter table public.order_journal_events enable row level security;

drop policy if exists order_journal_events_select on public.order_journal_events;
create policy order_journal_events_select
  on public.order_journal_events
  for select
  to authenticated
  using (public.has_permission('orders:read') or public.has_permission('diagnostics:read'));

grant select on public.order_diagnostics_items to authenticated;
grant select on public.order_journal_events to authenticated;

revoke all on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text) from public;
revoke all on function public.save_order_diagnostics(uuid, text, uuid, jsonb) from public;
revoke all on function public.get_order_journal(uuid) from public;
revoke all on function public.forbid_order_journal_mutation() from public;

grant execute on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text) to authenticated;
grant execute on function public.save_order_diagnostics(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.get_order_journal(uuid) to authenticated;
grant execute on function public.get_available_order_transitions(uuid) to authenticated;
