-- Поля карточки заказа: сопроводительная записка, комплектация, срок, ответственный.
-- Значения по-прежнему в public.orders; определения — в Полях карточек, группа «Заказ».

insert into public.dynamic_field_types (code, name, sort_order)
values
  ('text', 'Строка', 0),
  ('textarea', 'Многострочный текст', 1),
  ('number', 'Число', 2),
  ('date', 'Дата', 3),
  ('select', 'Список', 4),
  ('employee', 'Сотрудник', 5),
  ('checkbox', 'Флажок', 6)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order;

update public.dynamic_fields
set sort_order = sort_order + 10
where entity_code = 'orders';

insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
values
  ('orders', 'claimed_malfunction', 'Сопроводительная записка', 'textarea', true, 0, 'Заказ'),
  ('orders', 'completeness', 'Комплектация', 'textarea', false, 1, 'Заказ'),
  ('orders', 'deadline', 'Срок', 'date', false, 2, 'Заказ'),
  ('orders', 'responsible', 'Ответственный', 'employee', false, 3, 'Заказ')
on conflict (entity_code, code) do update
set group_name = case
  when public.dynamic_fields.group_name = '' then excluded.group_name
  else public.dynamic_fields.group_name
end;

create or replace function public.is_order_card_field(p_entity text, p_code text)
returns boolean
language sql
immutable
as $$
  select p_entity = 'orders'
    and p_code in ('claimed_malfunction', 'completeness', 'deadline', 'responsible');
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

  if public.is_order_card_field(current_row.entity_code, current_row.code) then
    raise exception 'Системное поле заказа нельзя удалить. Скройте его, если оно не нужно в форме.';
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
  end if;
  if target_entity_code = 'inventory' then
    permission_code := 'inventory:receive';
  end if;

  if not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
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
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
    end if;
  end loop;
end;
$$;

create or replace function public.upsert_dynamic_field(
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
  is_system boolean := false;
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

    is_system := public.is_order_card_field(current_row.entity_code, current_row.code);

    if is_system then
      if normalized_code <> current_row.code then
        raise exception 'Код системного поля заказа нельзя изменить.';
      end if;
      if p_type <> current_row.field_type then
        raise exception 'Тип системного поля заказа нельзя изменить.';
      end if;
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
      code = case when is_system or usage_count > 0 then current_row.code else normalized_code end,
      name = normalized_name,
      field_type = case when is_system then current_row.field_type else p_type end,
      is_required = p_required,
      group_name = normalized_group
    where id = current_row.id
    returning id into result_id;
  else
    if public.is_order_card_field(p_entity, normalized_code) then
      raise exception 'Этот код зарезервирован для системного поля заказа.';
    end if;

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

create or replace function public.create_order(
  target_customer_id uuid,
  target_device_id uuid,
  claimed_malfunction text,
  completeness text default '',
  external_condition text default '',
  target_deadline date default null,
  target_responsible_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  v_number text;
  v_seq integer;
  device_serial text;
  initial_status uuid;
  malfunction text;
begin
  if not public.has_permission('orders:create') then
    raise exception 'Недостаточно прав для создания заказа.';
  end if;

  malfunction := btrim(coalesce(claimed_malfunction, ''));

  if not exists (select 1 from public.customers where id = target_customer_id and is_active = true) then
    raise exception 'Клиент не найден.';
  end if;

  select serial_number into device_serial from public.devices where id = target_device_id;
  if device_serial is null then
    raise exception 'Прибор не найден.';
  end if;

  select m.status_id into initial_status
  from public.order_status_meta m
  join public.reference_items i on i.id = m.status_id
  where m.is_initial = true and i.is_active = true
  order by i.sort_order
  limit 1;

  if initial_status is null then
    raise exception 'Не задан начальный статус заказа.';
  end if;

  if target_responsible_id is not null
     and not exists (select 1 from public.profiles where id = target_responsible_id and is_active = true) then
    raise exception 'Ответственный сотрудник не найден.';
  end if;

  select n.order_number, n.seq into v_number, v_seq from public.next_order_number() as n;

  insert into public.orders (
    number, number_seq, customer_id, device_id, serial_number,
    claimed_malfunction, completeness, external_condition,
    deadline, responsible_id, status_id, created_by
  )
  values (
    v_number, v_seq, target_customer_id, target_device_id, device_serial,
    malfunction, btrim(coalesce(completeness, '')), btrim(coalesce(external_condition, '')),
    target_deadline, target_responsible_id, initial_status, auth.uid()
  )
  returning id into result_id;

  insert into public.order_status_events (order_id, from_status_id, to_status_id, actor_id, metadata)
  values (result_id, null, initial_status, auth.uid(), jsonb_build_object('source', 'create'));

  perform public.record_audit(
    'orders.created',
    'order',
    result_id::text,
    jsonb_build_object('number', v_number)
  );

  if target_responsible_id is not null then
    perform public.record_audit(
      'orders.assigned',
      'order',
      result_id::text,
      jsonb_build_object('responsible_id', target_responsible_id, 'number', v_number)
    );

    perform public.emit_domain_event(
      'responsible_assigned',
      'order',
      result_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', result_id,
        'order_number', v_number,
        'responsible_id', target_responsible_id,
        'title', 'Назначен заказ',
        'body', 'Вам назначен заказ ' || v_number
      )
    );
  end if;

  return result_id;
end;
$$;

create or replace function public.update_order(
  target_order_id uuid,
  claimed_malfunction text default null,
  completeness text default null,
  external_condition text default null,
  target_deadline date default null,
  clear_deadline boolean default false,
  target_responsible_id uuid default null,
  change_responsible boolean default false,
  target_customer_id uuid default null,
  change_customer boolean default false,
  target_device_id uuid default null,
  change_device boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  previous_responsible uuid;
  field_changed boolean;
  assigned boolean;
  device_serial text;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  if claimed_malfunction is not null or completeness is not null or external_condition is not null
     or target_deadline is not null or clear_deadline
     or change_customer or change_device then
    if not public.has_permission('orders:update') then
      raise exception 'Недостаточно прав для изменения заказа.';
    end if;
  end if;

  if change_responsible and not (public.has_permission('orders:assign') or public.has_permission('orders:update')) then
    raise exception 'Недостаточно прав для назначения ответственного.';
  end if;

  if change_customer then
    if target_customer_id is null then
      raise exception 'Укажите клиента.';
    end if;
    if not exists (select 1 from public.customers where id = target_customer_id and is_active = true) then
      raise exception 'Клиент не найден.';
    end if;
  end if;

  if change_device then
    if target_device_id is null then
      raise exception 'Укажите прибор.';
    end if;
    select serial_number into device_serial from public.devices where id = target_device_id;
    if device_serial is null then
      raise exception 'Прибор не найден.';
    end if;
  end if;

  previous_responsible := current_row.responsible_id;
  field_changed := claimed_malfunction is not null
    or completeness is not null
    or external_condition is not null
    or target_deadline is not null
    or clear_deadline
    or change_customer
    or change_device;
  assigned := change_responsible and target_responsible_id is distinct from previous_responsible;

  update public.orders
  set
    claimed_malfunction = case
      when claimed_malfunction is not null then btrim(claimed_malfunction)
      else orders.claimed_malfunction
    end,
    completeness = case
      when completeness is not null then btrim(completeness)
      else orders.completeness
    end,
    external_condition = case
      when external_condition is not null then btrim(external_condition)
      else orders.external_condition
    end,
    deadline = case
      when clear_deadline then null
      when target_deadline is not null then target_deadline
      else orders.deadline
    end,
    responsible_id = case
      when change_responsible then target_responsible_id
      else orders.responsible_id
    end,
    customer_id = case
      when change_customer then target_customer_id
      else orders.customer_id
    end,
    device_id = case
      when change_device then target_device_id
      else orders.device_id
    end,
    serial_number = case
      when change_device then device_serial
      else orders.serial_number
    end
  where id = target_order_id;

  if assigned then
    perform public.emit_domain_event(
      'responsible_assigned',
      'order',
      target_order_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', target_order_id,
        'order_number', current_row.number,
        'responsible_id', target_responsible_id,
        'title', 'Назначен заказ',
        'body', 'Вам назначен заказ ' || current_row.number
      )
    );

    perform public.record_audit(
      'orders.assigned',
      'order',
      target_order_id::text,
      jsonb_build_object(
        'previous_responsible_id', previous_responsible,
        'responsible_id', target_responsible_id,
        'number', current_row.number
      )
    );
  end if;

  if field_changed then
    perform public.record_audit('orders.updated', 'order', target_order_id::text, '{}'::jsonb);
  end if;
end;
$$;
