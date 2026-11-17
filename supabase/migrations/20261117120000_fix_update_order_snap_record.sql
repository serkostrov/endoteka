-- PL/pgSQL evaluates record fields when building SQL params, so referencing
-- snap.* inside CASE in UPDATE throws "record snap is not assigned yet"
-- even when change_device is false. Assign next_* locals instead.
-- Also use FOUND after SELECT INTO (accessing unassigned record is an error).

create or replace function public.apply_order_device_snapshot(
  target_order_id uuid,
  target_device_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  snap record;
begin
  if target_order_id is null or target_device_id is null then
    return;
  end if;

  select * into snap from public.device_classification_snapshot(target_device_id);
  if not found then
    return;
  end if;

  update public.orders
  set serial_number = snap.serial_number,
      device_group = snap.device_group,
      device_brand = snap.device_brand,
      device_model = snap.device_model,
      device_label = snap.device_label
  where id = target_order_id;
end;
$$;

create or replace function public.create_order(
  target_customer_id uuid,
  target_device_id uuid,
  claimed_malfunction text,
  completeness text default '',
  external_condition text default '',
  target_deadline date default null,
  target_responsible_id uuid default null,
  target_ready_date date default null
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
  initial_status uuid;
  malfunction text;
  snap record;
begin
  if not public.has_permission('orders:create') then
    raise exception 'Недостаточно прав для создания заказа.';
  end if;

  malfunction := btrim(coalesce(claimed_malfunction, ''));

  if not exists (select 1 from public.customers where id = target_customer_id and is_active = true) then
    raise exception 'Клиент не найден.';
  end if;

  select * into snap from public.device_classification_snapshot(target_device_id);
  if not found then
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
    device_group, device_brand, device_model, device_label,
    claimed_malfunction, completeness, external_condition,
    deadline, ready_date, responsible_id, status_id, created_by
  )
  values (
    v_number, v_seq, target_customer_id, target_device_id, snap.serial_number,
    snap.device_group, snap.device_brand, snap.device_model, snap.device_label,
    malfunction, btrim(coalesce(completeness, '')), btrim(coalesce(external_condition, '')),
    target_deadline, target_ready_date, target_responsible_id, initial_status, auth.uid()
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
  change_device boolean default false,
  target_ready_date date default null,
  clear_ready_date boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  current_row public.orders%rowtype;
  previous_responsible uuid;
  field_changed boolean;
  assigned boolean;
  next_malfunction text := claimed_malfunction;
  next_completeness text := completeness;
  next_external text := external_condition;
  changes jsonb := '[]'::jsonb;
  next_deadline date;
  next_ready_date date;
  next_responsible uuid;
  next_customer uuid;
  next_device uuid;
  next_serial text;
  next_device_group text;
  next_device_brand text;
  next_device_model text;
  next_device_label text;
  old_customer_name text;
  new_customer_name text;
  old_device_label text;
  new_device_label text;
  old_responsible_name text;
  new_responsible_name text;
  snap record;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  if next_malfunction is not null or next_completeness is not null or next_external is not null
     or target_deadline is not null or clear_deadline
     or target_ready_date is not null or clear_ready_date
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

  next_serial := current_row.serial_number;
  next_device_group := current_row.device_group;
  next_device_brand := current_row.device_brand;
  next_device_model := current_row.device_model;
  next_device_label := current_row.device_label;

  if change_device then
    if target_device_id is null then
      raise exception 'Укажите прибор.';
    end if;
    select * into snap from public.device_classification_snapshot(target_device_id);
    if not found then
      raise exception 'Прибор не найден.';
    end if;
    next_serial := snap.serial_number;
    next_device_group := snap.device_group;
    next_device_brand := snap.device_brand;
    next_device_model := snap.device_model;
    next_device_label := snap.device_label;
  end if;

  previous_responsible := current_row.responsible_id;
  next_deadline := case
    when clear_deadline then null
    when target_deadline is not null then target_deadline
    else current_row.deadline
  end;
  next_ready_date := case
    when clear_ready_date then null
    when target_ready_date is not null then target_ready_date
    else current_row.ready_date
  end;
  next_responsible := case
    when change_responsible then target_responsible_id
    else current_row.responsible_id
  end;
  next_customer := case
    when change_customer then target_customer_id
    else current_row.customer_id
  end;
  next_device := case
    when change_device then target_device_id
    else current_row.device_id
  end;

  field_changed := next_malfunction is not null
    or next_completeness is not null
    or next_external is not null
    or target_deadline is not null
    or clear_deadline
    or target_ready_date is not null
    or clear_ready_date
    or change_customer
    or change_device;
  assigned := change_responsible and target_responsible_id is distinct from previous_responsible;

  if next_malfunction is not null and btrim(next_malfunction) is distinct from current_row.claimed_malfunction then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'claimed_malfunction',
      'label', 'Неисправность',
      'from', to_jsonb(nullif(current_row.claimed_malfunction, '')),
      'to', to_jsonb(nullif(btrim(next_malfunction), ''))
    ));
  end if;

  if next_completeness is not null and btrim(next_completeness) is distinct from current_row.completeness then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'completeness',
      'label', 'Комплектность',
      'from', to_jsonb(nullif(current_row.completeness, '')),
      'to', to_jsonb(nullif(btrim(next_completeness), ''))
    ));
  end if;

  if next_external is not null and btrim(next_external) is distinct from current_row.external_condition then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'external_condition',
      'label', 'Внешний вид',
      'from', to_jsonb(nullif(current_row.external_condition, '')),
      'to', to_jsonb(nullif(btrim(next_external), ''))
    ));
  end if;

  if (clear_deadline or target_deadline is not null)
     and next_deadline is distinct from current_row.deadline then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'deadline',
      'label', 'Срок',
      'from', to_jsonb(current_row.deadline),
      'to', to_jsonb(next_deadline)
    ));
  end if;

  if (clear_ready_date or target_ready_date is not null)
     and next_ready_date is distinct from current_row.ready_date then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'ready_date',
      'label', 'Дата готовности',
      'from', to_jsonb(current_row.ready_date),
      'to', to_jsonb(next_ready_date)
    ));
  end if;

  if assigned then
    select coalesce(nullif(full_name, ''), email, '') into old_responsible_name
    from public.profiles where id = previous_responsible;
    select coalesce(nullif(full_name, ''), email, '') into new_responsible_name
    from public.profiles where id = next_responsible;
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'responsible_id',
      'label', 'Ответственный',
      'from', to_jsonb(nullif(old_responsible_name, '')),
      'to', to_jsonb(nullif(new_responsible_name, ''))
    ));
  end if;

  if change_customer and next_customer is distinct from current_row.customer_id then
    select c.name into old_customer_name from public.customers c where c.id = current_row.customer_id;
    select c.name into new_customer_name from public.customers c where c.id = next_customer;
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'customer_id',
      'label', 'Клиент',
      'from', to_jsonb(old_customer_name),
      'to', to_jsonb(new_customer_name)
    ));
  end if;

  if change_device and next_device is distinct from current_row.device_id then
    old_device_label := coalesce(
      nullif(btrim(current_row.device_label), ''),
      nullif(btrim(current_row.serial_number), ''),
      ''
    );
    new_device_label := trim(both ' ' from concat_ws(' ', next_device_brand, next_device_model, next_serial));
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'device_id',
      'label', 'Прибор',
      'from', to_jsonb(nullif(old_device_label, '')),
      'to', to_jsonb(nullif(new_device_label, ''))
    ));
  end if;

  update public.orders
  set
    claimed_malfunction = case
      when next_malfunction is not null then btrim(next_malfunction)
      else orders.claimed_malfunction
    end,
    completeness = case
      when next_completeness is not null then btrim(next_completeness)
      else orders.completeness
    end,
    external_condition = case
      when next_external is not null then btrim(next_external)
      else orders.external_condition
    end,
    deadline = next_deadline,
    ready_date = next_ready_date,
    responsible_id = next_responsible,
    customer_id = next_customer,
    device_id = next_device,
    serial_number = next_serial,
    device_group = next_device_group,
    device_brand = next_device_brand,
    device_model = next_device_model,
    device_label = next_device_label
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

  if jsonb_array_length(changes) > 0 then
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      target_order_id,
      'order_updated',
      auth.uid(),
      'Изменения в заказе',
      jsonb_build_object('changes', changes)
    );

    perform public.record_audit(
      'orders.updated',
      'order',
      target_order_id::text,
      jsonb_build_object('changes', changes)
    );
  elsif field_changed then
    perform public.record_audit('orders.updated', 'order', target_order_id::text, '{}'::jsonb);
  end if;
end;
$$;

revoke all on function public.apply_order_device_snapshot(uuid, uuid) from public, anon;
revoke all on function public.create_order(uuid, uuid, text, text, text, date, uuid, date) from public, anon;
revoke all on function public.update_order(uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean) from public, anon;

grant execute on function public.apply_order_device_snapshot(uuid, uuid) to authenticated;
grant execute on function public.create_order(uuid, uuid, text, text, text, date, uuid, date) to authenticated;
grant execute on function public.update_order(uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean) to authenticated;

notify pgrst, 'reload schema';
