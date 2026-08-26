-- Приборы: классификация, уникальный серийный номер, гарантии, поиск для заказа.

alter table public.devices
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.devices drop constraint if exists devices_serial_unique;
drop index if exists devices_serial_unique;

create unique index if not exists devices_serial_unique
  on public.devices (lower(btrim(serial_number)));

insert into public.app_settings (key, value)
values ('warranty', jsonb_build_object('default_months', 6))
on conflict (key) do nothing;

create table if not exists public.device_warranties (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  order_id uuid references public.orders (id) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint device_warranties_range check (ends_on >= starts_on),
  constraint device_warranties_order_unique unique (order_id)
);

create index if not exists device_warranties_device_idx
  on public.device_warranties (device_id, ends_on desc);

create or replace function public.warranty_status(starts_on date, ends_on date)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when starts_on is null or ends_on is null then null
    when starts_on > current_date then 'upcoming'
    when ends_on < current_date then 'expired'
    else 'active'
  end;
$$;

create or replace function public.assert_device_classification(
  device_group_id uuid,
  device_brand_id uuid,
  device_model_id uuid,
  device_modification_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  set_code text;
  parent uuid;
begin
  if device_group_id is not null then
    select s.code into set_code
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_group_id and i.is_active = true;
    if set_code is distinct from 'device_groups' then
      raise exception 'Некорректная группа прибора.';
    end if;
  end if;

  if device_brand_id is not null then
    select s.code into set_code
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_brand_id and i.is_active = true;
    if set_code is distinct from 'device_brands' then
      raise exception 'Некорректный бренд прибора.';
    end if;
  end if;

  if device_model_id is not null then
    select s.code, i.parent_id into set_code, parent
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_model_id and i.is_active = true;
    if set_code is distinct from 'device_models' then
      raise exception 'Некорректная модель прибора.';
    end if;
    if device_brand_id is not null and parent is distinct from device_brand_id then
      raise exception 'Модель не относится к выбранному бренду.';
    end if;
  end if;

  if device_modification_id is not null then
    select s.code, i.parent_id into set_code, parent
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_modification_id and i.is_active = true;
    if set_code is distinct from 'device_modifications' then
      raise exception 'Некорректная модификация прибора.';
    end if;
    if device_model_id is not null and parent is distinct from device_model_id then
      raise exception 'Модификация не относится к выбранной модели.';
    end if;
  end if;
end;
$$;

create or replace function public.create_device(
  device_serial text,
  device_customer_id uuid default null,
  device_group_id uuid default null,
  device_brand_id uuid default null,
  device_model_id uuid default null,
  device_modification_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  serial text;
begin
  if not public.has_permission('devices:create') then
    raise exception 'Недостаточно прав для создания прибора.';
  end if;

  serial := btrim(coalesce(device_serial, ''));
  if char_length(serial) < 1 then
    raise exception 'Укажите серийный номер.';
  end if;

  perform public.assert_device_classification(
    device_group_id, device_brand_id, device_model_id, device_modification_id
  );

  insert into public.devices (
    serial_number, customer_id, group_id, brand_id, model_id, modification_id
  )
  values (
    serial, device_customer_id, device_group_id, device_brand_id, device_model_id, device_modification_id
  )
  returning id into result_id;

  perform public.record_audit('devices.created', 'device', result_id::text, jsonb_build_object('serial', serial));
  return result_id;
exception
  when unique_violation then
    select id into result_id
    from public.devices
    where lower(btrim(serial_number)) = lower(serial)
    limit 1;
    raise exception 'Прибор с таким серийным номером уже существует'
      using hint = coalesce(result_id::text, '');
end;
$$;

create or replace function public.update_device(
  target_device_id uuid,
  device_group_id uuid default null,
  device_brand_id uuid default null,
  device_model_id uuid default null,
  device_modification_id uuid default null,
  device_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('devices:update') then
    raise exception 'Недостаточно прав для изменения прибора.';
  end if;

  if not exists (select 1 from public.devices where id = target_device_id) then
    raise exception 'Прибор не найден.';
  end if;

  perform public.assert_device_classification(
    device_group_id, device_brand_id, device_model_id, device_modification_id
  );

  update public.devices
  set
    group_id = device_group_id,
    brand_id = device_brand_id,
    model_id = device_model_id,
    modification_id = device_modification_id,
    metadata = coalesce(device_metadata, metadata)
  where id = target_device_id;

  perform public.record_audit('devices.updated', 'device', target_device_id::text, '{}'::jsonb);
end;
$$;

create or replace view public.device_list_items
with (security_invoker = true) as
select
  d.id,
  d.serial_number,
  d.customer_id,
  d.group_id,
  d.brand_id,
  d.model_id,
  d.modification_id,
  d.metadata,
  d.notes,
  d.created_at,
  d.updated_at,
  coalesce(grp.name, '') as group_name,
  coalesce(brand.name, '') as brand_name,
  coalesce(model.name, '') as model_name,
  coalesce(modif.name, '') as modification_name,
  trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), coalesce(modif.name, ''))) as label,
  w.id as warranty_id,
  w.starts_on as warranty_start,
  w.ends_on as warranty_end,
  public.warranty_status(w.starts_on, w.ends_on) as warranty_status
from public.devices d
left join public.reference_items grp on grp.id = d.group_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id
left join public.reference_items modif on modif.id = d.modification_id
left join lateral (
  select dw.id, dw.starts_on, dw.ends_on
  from public.device_warranties dw
  where dw.device_id = d.id
  order by
    case public.warranty_status(dw.starts_on, dw.ends_on)
      when 'active' then 0
      when 'upcoming' then 1
      else 2
    end,
    dw.ends_on desc
  limit 1
) w on true;

create or replace function public.device_warranty_json(target_device_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'id', w.id,
        'starts_on', w.starts_on,
        'ends_on', w.ends_on,
        'status', public.warranty_status(w.starts_on, w.ends_on),
        'order_id', w.order_id,
        'order_number', o.number
      )
      from public.device_warranties w
      left join public.orders o on o.id = w.order_id
      where w.device_id = target_device_id
      order by
        case public.warranty_status(w.starts_on, w.ends_on)
          when 'active' then 0
          when 'upcoming' then 1
          else 2
        end,
        w.ends_on desc
      limit 1
    ),
    'null'::jsonb
  );
$$;

create or replace function public.device_repairs_json(target_device_id uuid, max_rows integer default 8)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_agg(item order by ord.created_at desc)
      from (
        select jsonb_build_object(
          'id', o.id,
          'number', o.number,
          'customer_id', o.customer_id,
          'customer_name', c.name,
          'status_name', st.name,
          'status_code', st.code,
          'claimed_malfunction', o.claimed_malfunction,
          'created_at', o.created_at,
          'updated_at', o.updated_at,
          'deadline', o.deadline
        ) as item,
        o.created_at
        from public.orders o
        join public.customers c on c.id = o.customer_id
        join public.reference_items st on st.id = o.status_id
        where o.device_id = target_device_id
        order by o.created_at desc
        limit greatest(coalesce(max_rows, 8), 1)
      ) ord
    ),
    '[]'::jsonb
  );
$$;

create or replace function public.device_payload(target_device_id uuid, repair_limit integer default 8)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id,
    'serial_number', d.serial_number,
    'group_id', d.group_id,
    'brand_id', d.brand_id,
    'model_id', d.model_id,
    'modification_id', d.modification_id,
    'group_name', coalesce(grp.name, ''),
    'brand_name', coalesce(brand.name, ''),
    'model_name', coalesce(model.name, ''),
    'modification_name', coalesce(modif.name, ''),
    'label', trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), coalesce(modif.name, ''))),
    'metadata', d.metadata,
    'created_at', d.created_at,
    'updated_at', d.updated_at,
    'warranty', public.device_warranty_json(d.id),
    'latest_order', (
      select value
      from jsonb_array_elements(public.device_repairs_json(d.id, 1))
      limit 1
    ),
    'repairs', public.device_repairs_json(d.id, repair_limit)
  )
  from public.devices d
  left join public.reference_items grp on grp.id = d.group_id
  left join public.reference_items brand on brand.id = d.brand_id
  left join public.reference_items model on model.id = d.model_id
  left join public.reference_items modif on modif.id = d.modification_id
  where d.id = target_device_id;
$$;

create or replace function public.search_device_serial(serial_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  exact_id uuid;
begin
  if not (public.has_permission('devices:read') or public.has_permission('orders:read') or public.has_permission('orders:create') or public.has_permission('devices:create')) then
    raise exception 'Недостаточно прав.';
  end if;

  term := btrim(coalesce(serial_query, ''));
  if char_length(term) < 2 then
    return jsonb_build_object('kind', 'empty', 'device', null, 'items', '[]'::jsonb);
  end if;

  select d.id into exact_id
  from public.devices d
  where lower(btrim(d.serial_number)) = lower(term)
  limit 1;

  if exact_id is not null then
    return jsonb_build_object(
      'kind', 'exact',
      'device', public.device_payload(exact_id, 5),
      'items', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'kind', 'list',
    'device', null,
    'items', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', d.id,
          'serial_number', d.serial_number,
          'label', trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''))),
          'group_name', coalesce(grp.name, ''),
          'brand_name', coalesce(brand.name, ''),
          'model_name', coalesce(model.name, '')
        ) order by d.serial_number)
        from (
          select *
          from public.devices
          where serial_number ilike '%' || term || '%'
          order by serial_number
          limit 8
        ) d
        left join public.reference_items grp on grp.id = d.group_id
        left join public.reference_items brand on brand.id = d.brand_id
        left join public.reference_items model on model.id = d.model_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_device_card(target_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission('devices:read') or public.has_permission('orders:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.devices where id = target_device_id) then
    return null;
  end if;

  return jsonb_build_object(
    'device', public.device_payload(target_device_id, 50),
    'warranties', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', w.id,
          'starts_on', w.starts_on,
          'ends_on', w.ends_on,
          'status', public.warranty_status(w.starts_on, w.ends_on),
          'order_id', w.order_id,
          'order_number', o.number,
          'created_at', w.created_at
        ) order by w.starts_on desc, w.created_at desc)
        from public.device_warranties w
        left join public.orders o on o.id = w.order_id
        where w.device_id = target_device_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_warranty_defaults()
returns table (starts_on date, ends_on date, default_months integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  months integer := 6;
begin
  if not (public.has_permission('orders:change_status') or public.has_permission('orders:read') or public.has_permission('devices:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  select coalesce((value ->> 'default_months')::integer, 6)
    into months
  from public.app_settings
  where key = 'warranty';

  starts_on := current_date;
  ends_on := (current_date + make_interval(months => greatest(months, 1)))::date;
  default_months := greatest(months, 1);
  return next;
end;
$$;

drop function if exists public.change_order_status(uuid, uuid);

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
  transition public.order_status_transitions%rowtype;
  rule_code text;
  to_name text;
  to_code text;
  from_name text;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  select * into transition
  from public.order_status_transitions
  where from_status_id = current_row.status_id
    and to_status_id = target_status_id
    and is_active = true;

  if transition.id is null then
    raise exception 'Такой переход статуса не разрешён.';
  end if;

  if not public.has_permission(transition.required_permission) then
    raise exception 'Недостаточно прав для этого перехода.';
  end if;

  for rule_code in
    select r.rule_code from public.order_transition_rules r where r.transition_id = transition.id
  loop
    if not public.transition_rule_passed(rule_code, current_row) then
      if rule_code = 'diagnostics_conclusion' then
        raise exception 'Сначала заполните заключение диагностики.';
      end if;
      if rule_code = 'responsible_assigned' then
        raise exception 'Назначьте ответственного сотрудника.';
      end if;
      raise exception 'Не выполнено условие перехода.';
    end if;
  end loop;

  select name, code into to_name, to_code from public.reference_items where id = target_status_id;
  select name into from_name from public.reference_items where id = current_row.status_id;

  if to_code = 'issued' then
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

  if to_code = 'issued' then
    insert into public.device_warranties (device_id, order_id, starts_on, ends_on, created_by)
    values (current_row.device_id, target_order_id, warranty_start, warranty_end, auth.uid());
  end if;

  if exists (
    select 1 from public.order_status_meta
    where status_id = target_status_id and notifies_warehouse = true
  ) then
    perform public.fanout_notification(
      'warehouse_repair_started',
      'Заказ в ремонте',
      'Заказ ' || current_row.number || ' переведён в ремонт. Проверьте склад.',
      'order',
      target_order_id::text,
      target_order_id
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

alter table public.device_warranties enable row level security;

drop policy if exists device_warranties_select on public.device_warranties;
create policy device_warranties_select
  on public.device_warranties
  for select
  to authenticated
  using (public.has_permission('devices:read') or public.has_permission('orders:read'));

grant select on public.device_list_items to authenticated;

revoke all on function public.warranty_status(date, date) from public;
revoke all on function public.assert_device_classification(uuid, uuid, uuid, uuid) from public;
revoke all on function public.create_device(text, uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.device_warranty_json(uuid) from public;
revoke all on function public.device_repairs_json(uuid, integer) from public;
revoke all on function public.device_payload(uuid, integer) from public;
revoke all on function public.search_device_serial(text) from public;
revoke all on function public.get_device_card(uuid) from public;
revoke all on function public.get_warranty_defaults() from public;
revoke all on function public.change_order_status(uuid, uuid, date, date) from public;

grant execute on function public.create_device(text, uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.search_device_serial(text) to authenticated;
grant execute on function public.get_device_card(uuid) to authenticated;
grant execute on function public.get_warranty_defaults() to authenticated;
grant execute on function public.change_order_status(uuid, uuid, date, date) to authenticated;
