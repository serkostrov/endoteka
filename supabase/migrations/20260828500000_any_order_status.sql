-- Заказ можно перевести в любой активный статус, без графа переходов.

create or replace function public.sync_order_status_transitions()
returns void
language plpgsql
as $$
begin
  insert into public.order_status_transitions (from_status_id, to_status_id, required_permission, sort_order)
  select src.id, dst.id, 'orders:change_status', dst.sort_order
  from public.reference_items src
  join public.reference_sets s on s.id = src.set_id and s.code = 'order_statuses'
  join public.reference_items dst on dst.set_id = src.set_id and dst.id <> src.id and dst.is_active
  where src.is_active
  on conflict (from_status_id, to_status_id) do nothing;
end;
$$;

select public.sync_order_status_transitions();

create or replace function public.change_order_status(
  target_order_id uuid,
  target_status_id uuid,
  warranty_start date default null,
  warranty_end date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  to_name text;
  to_code text;
  from_name text;
  needs_warranty boolean := false;
begin
  if not (
    public.has_permission('orders:change_status')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для смены статуса.';
  end if;

  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  if current_row.status_id = target_status_id then
    return;
  end if;

  if not exists (
    select 1
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id and s.code = 'order_statuses'
    where i.id = target_status_id
      and i.is_active
  ) then
    raise exception 'Статус не найден.';
  end if;

  select name, code into to_name, to_code from public.reference_items where id = target_status_id;
  select name into from_name from public.reference_items where id = current_row.status_id;
  select coalesce(requires_warranty, false) into needs_warranty
  from public.order_status_meta
  where status_id = target_status_id;

  if needs_warranty then
    if warranty_start is null or warranty_end is null then
      raise exception 'Укажите срок гарантии.';
    end if;
    if warranty_end < warranty_start then
      raise exception 'Дата окончания гарантии не может быть раньше начала.';
    end if;
  end if;

  update public.orders
  set status_id = target_status_id
  where id = target_order_id;

  insert into public.order_status_events (order_id, from_status_id, to_status_id, actor_id, metadata)
  values (
    target_order_id,
    current_row.status_id,
    target_status_id,
    auth.uid(),
    jsonb_build_object('from_name', from_name, 'to_name', to_name)
  );

  if needs_warranty then
    insert into public.device_warranties (device_id, order_id, starts_on, ends_on, created_by)
    values (current_row.device_id, target_order_id, warranty_start, warranty_end, auth.uid());
  end if;

  perform public.emit_domain_event(
    'order_status_changed',
    'order',
    target_order_id::text,
    jsonb_build_object(
      'actor_id', auth.uid(),
      'order_id', target_order_id,
      'order_number', current_row.number,
      'responsible_id', current_row.responsible_id,
      'from_status', from_name,
      'to_status', to_name,
      'to_code', to_code,
      'title', 'Статус заказа изменён',
      'body', 'Заказ ' || current_row.number || ': ' || coalesce(from_name, '') || ' → ' || coalesce(to_name, '')
    )
  );

  if exists (
    select 1 from public.order_status_meta
    where status_id = target_status_id and notifies_warehouse = true
  ) then
    perform public.emit_domain_event(
      'order_in_repair',
      'order',
      target_order_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', target_order_id,
        'order_number', current_row.number,
        'title', 'Заказ в ремонте',
        'body', 'Заказ ' || current_row.number || ' переведён в ремонт. Проверьте склад.'
      )
    );
  end if;

  perform public.record_audit(
    'orders.status_changed',
    'order',
    target_order_id::text,
    jsonb_build_object('from', current_row.status_id, 'to', target_status_id, 'to_code', to_code)
  );
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
  block_reason text,
  group_code text,
  group_name text,
  group_sort_order integer,
  color text,
  requires_warranty boolean,
  is_destructive boolean
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
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав.';
  end if;

  select * into current_row from public.orders where id = target_order_id;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  allowed := public.has_permission('orders:change_status') or public.has_permission('orders:update');
  if not allowed then
    reason := 'Недостаточно прав для смены статуса.';
  else
    reason := null;
  end if;

  for rec in
    select
      i.id,
      i.code,
      i.name,
      g.code as group_code,
      g.name as group_name,
      coalesce(g.sort_order, 999) as group_sort_order,
      coalesce(nullif(m.color, ''), g.color) as color,
      coalesce(m.requires_warranty, false) as requires_warranty,
      coalesce(m.is_destructive, false) as is_destructive
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id and s.code = 'order_statuses'
    left join public.order_status_meta m on m.status_id = i.id
    left join public.order_status_groups g on g.id = m.group_id
    where i.is_active
      and i.id <> current_row.status_id
    order by coalesce(g.sort_order, 999), i.sort_order, i.name
  loop
    transition_id := rec.id;
    to_status_id := rec.id;
    to_status_code := rec.code;
    to_status_name := rec.name;
    required_permission := 'orders:change_status';
    is_allowed := allowed;
    block_reason := reason;
    group_code := rec.group_code;
    group_name := rec.group_name;
    group_sort_order := rec.group_sort_order;
    color := rec.color;
    requires_warranty := rec.requires_warranty;
    is_destructive := rec.is_destructive;
    return next;
  end loop;
end;
$$;

revoke all on function public.change_order_status(uuid, uuid, date, date) from public, anon;
revoke all on function public.get_available_order_transitions(uuid) from public, anon;
grant execute on function public.change_order_status(uuid, uuid, date, date) to authenticated;
grant execute on function public.get_available_order_transitions(uuid) to authenticated;
