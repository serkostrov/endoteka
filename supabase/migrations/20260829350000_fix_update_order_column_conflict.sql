-- Параметры update_order совпадали с колонками orders. В UPDATE PostgreSQL
-- считает ссылку неоднозначной, и автосохранение полей заказа падает.

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
#variable_conflict use_variable
declare
  current_row public.orders%rowtype;
  previous_responsible uuid;
  field_changed boolean;
  assigned boolean;
  device_serial text;
  next_malfunction text := claimed_malfunction;
  next_completeness text := completeness;
  next_external text := external_condition;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  if next_malfunction is not null or next_completeness is not null or next_external is not null
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
    select d.serial_number into device_serial from public.devices d where d.id = target_device_id;
    if device_serial is null then
      raise exception 'Прибор не найден.';
    end if;
  end if;

  previous_responsible := current_row.responsible_id;
  field_changed := next_malfunction is not null
    or next_completeness is not null
    or next_external is not null
    or target_deadline is not null
    or clear_deadline
    or change_customer
    or change_device;
  assigned := change_responsible and target_responsible_id is distinct from previous_responsible;

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
) from public, anon;
grant execute on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean
) to authenticated;

notify pgrst, 'reload schema';
