-- Клиент и прибор заказа можно сменить из карточки. События пишутся в журнал.

drop function if exists public.update_order(uuid, text, text, text, date, boolean, uuid, boolean);
drop function if exists public.update_order(uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean);

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

  if claimed_malfunction is not null and char_length(btrim(claimed_malfunction)) < 1 then
    raise exception 'Укажите заявленную неисправность.';
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

revoke all on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean
) from public;
grant execute on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean
) to authenticated;

create or replace function public.write_order_journal_on_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_name text;
  next_name text;
begin
  if new.customer_id is not distinct from old.customer_id then
    return new;
  end if;

  select c.name into previous_name from public.customers c where c.id = old.customer_id;
  select c.name into next_name from public.customers c where c.id = new.customer_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    new.id,
    'customer_changed',
    auth.uid(),
    'Клиент: ' || coalesce(nullif(previous_name, ''), '—') || ' → ' || coalesce(nullif(next_name, ''), '—'),
    jsonb_build_object(
      'customer_id', new.customer_id,
      'previous_customer_id', old.customer_id
    )
  );

  return new;
end;
$$;

drop trigger if exists orders_customer_journal on public.orders;
create trigger orders_customer_journal
  after update of customer_id on public.orders
  for each row
  execute procedure public.write_order_journal_on_customer();

create or replace function public.write_order_journal_on_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.device_id is not distinct from old.device_id then
    return new;
  end if;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    new.id,
    'device_changed',
    auth.uid(),
    'Прибор: СН ' || coalesce(nullif(old.serial_number, ''), '—')
      || ' → СН ' || coalesce(nullif(new.serial_number, ''), '—'),
    jsonb_build_object(
      'device_id', new.device_id,
      'previous_device_id', old.device_id,
      'serial_number', new.serial_number,
      'previous_serial_number', old.serial_number
    )
  );

  return new;
end;
$$;

drop trigger if exists orders_device_journal on public.orders;
create trigger orders_device_journal
  after update of device_id on public.orders
  for each row
  execute procedure public.write_order_journal_on_device();
