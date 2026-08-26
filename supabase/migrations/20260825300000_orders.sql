-- Эндотека: заказы, клиенты, приборы, маршрут статусов, журнал, файлы, уведомления.
-- Номер заказа выдаётся только в БД, с блокировкой строки последовательности.
-- Зависит от 20260825200000_reference_data_and_dynamic_fields.sql (reference_sets / reference_items).

do $$
begin
  if to_regclass('public.reference_items') is null or to_regclass('public.reference_sets') is null then
    raise exception 'Сначала примените миграцию 20260825200000_reference_data_and_dynamic_fields.sql (нет public.reference_items).';
  end if;
end $$;

update public.reference_items i
set name = v.name
from public.reference_sets s,
  (values
    ('repair', 'В ремонте'),
    ('quality_check', 'Выходной контроль'),
    ('ready', 'Готов к отправке'),
    ('cancelled', 'Отказ/возврат без ремонта')
  ) as v(code, name)
where s.code = 'order_statuses'
  and i.set_id = s.id
  and i.code = v.code;

update public.reference_items i
set is_active = false
from public.reference_sets s
where s.code = 'order_statuses'
  and i.set_id = s.id
  and i.code = 'waiting_parts';

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, v.code, v.name, v.sort_order, true
from public.reference_sets s
join (
  values
    ('warehouse_repair_started', 'Заказ переведён в ремонт', 4),
    ('order_deadline_approaching', 'Приближается срок заказа', 5),
    ('order_deadline_overdue', 'Срок заказа просрочен', 6)
) as v(code, name, sort_order) on true
where s.code = 'notification_event_types'
on conflict do nothing;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute procedure public.set_updated_at();

insert into public.app_settings (key, value)
values
  ('order_number', jsonb_build_object('prefix', 'ЗК', 'start', 1, 'pad', 4)),
  ('deadline', jsonb_build_object('approaching_days', 2))
on conflict (key) do nothing;

create table if not exists public.order_number_sequence (
  id smallint primary key default 1 check (id = 1),
  prefix text not null default 'ЗК',
  pad_width integer not null default 4 check (pad_width between 3 and 8),
  start_value integer not null default 1 check (start_value >= 1),
  last_value integer not null default 0 check (last_value >= 0)
);

insert into public.order_number_sequence (id, prefix, pad_width, start_value, last_value)
values (1, 'ЗК', 4, 1, 0)
on conflict (id) do nothing;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  inn text not null default '',
  phone text not null default '',
  email text not null default '',
  city text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_name_idx on public.customers (lower(name));
create index if not exists customers_inn_idx on public.customers (inn);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute procedure public.set_updated_at();

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  group_id uuid references public.reference_items (id) on delete set null,
  brand_id uuid references public.reference_items (id) on delete set null,
  model_id uuid references public.reference_items (id) on delete set null,
  modification_id uuid references public.reference_items (id) on delete set null,
  serial_number text not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_serial_unique unique (serial_number)
);

create index if not exists devices_serial_idx on public.devices (lower(serial_number));
create index if not exists devices_customer_idx on public.devices (customer_id);

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute procedure public.set_updated_at();

create table if not exists public.order_status_meta (
  status_id uuid primary key references public.reference_items (id) on delete cascade,
  is_initial boolean not null default false,
  is_terminal boolean not null default false,
  notifies_warehouse boolean not null default false
);

insert into public.order_status_meta (status_id, is_initial, is_terminal, notifies_warehouse)
select i.id,
  i.code = 'received',
  i.code in ('issued', 'cancelled'),
  i.code = 'repair'
from public.reference_items i
join public.reference_sets s on s.id = i.set_id
where s.code = 'order_statuses'
on conflict (status_id) do update
  set is_initial = excluded.is_initial,
      is_terminal = excluded.is_terminal,
      notifies_warehouse = excluded.notifies_warehouse;

create table if not exists public.transition_rule_types (
  code text primary key,
  name text not null,
  description text
);

insert into public.transition_rule_types (code, name, description)
values
  ('diagnostics_conclusion', 'Заключение диагностики', 'Нужно заполненное заключение диагностики'),
  ('responsible_assigned', 'Ответственный', 'У заказа должен быть ответственный сотрудник')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description;

create table if not exists public.order_status_transitions (
  id uuid primary key default gen_random_uuid(),
  from_status_id uuid not null references public.reference_items (id) on delete restrict,
  to_status_id uuid not null references public.reference_items (id) on delete restrict,
  required_permission text not null default 'orders:change_status',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_status_transitions_unique unique (from_status_id, to_status_id)
);

create trigger order_status_transitions_set_updated_at
  before update on public.order_status_transitions
  for each row execute procedure public.set_updated_at();

create table if not exists public.order_transition_rules (
  transition_id uuid not null references public.order_status_transitions (id) on delete cascade,
  rule_code text not null references public.transition_rule_types (code) on delete restrict,
  primary key (transition_id, rule_code)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  number_seq integer not null,
  customer_id uuid not null references public.customers (id) on delete restrict,
  device_id uuid not null references public.devices (id) on delete restrict,
  serial_number text not null,
  claimed_malfunction text not null default '',
  completeness text not null default '',
  external_condition text not null default '',
  deadline date,
  responsible_id uuid references public.profiles (id) on delete set null,
  status_id uuid not null references public.reference_items (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_number_unique unique (number)
);

create index if not exists orders_status_idx on public.orders (status_id);
create index if not exists orders_responsible_idx on public.orders (responsible_id);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_deadline_idx on public.orders (deadline);
create index if not exists orders_updated_idx on public.orders (updated_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute procedure public.set_updated_at();

create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status_id uuid references public.reference_items (id) on delete set null,
  to_status_id uuid not null references public.reference_items (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_status_events_order_idx
  on public.order_status_events (order_id, created_at desc);

create table if not exists public.order_diagnostics (
  order_id uuid primary key references public.orders (id) on delete cascade,
  conclusion text not null default '',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.order_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('photo', 'pdf', 'url')),
  file_path text,
  file_name text,
  mime_type text,
  file_size integer,
  url text,
  caption text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_attachments_payload check (
    (kind = 'url' and url is not null and file_path is null)
    or (kind in ('photo', 'pdf') and file_path is not null)
  )
);

create index if not exists order_attachments_order_idx on public.order_attachments (order_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  event_code text not null,
  title text not null,
  body text not null,
  entity_type text,
  entity_id text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

create table if not exists public.notification_routes (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  target_kind text not null check (target_kind in ('role', 'responsible')),
  role_id uuid references public.roles (id) on delete cascade
);

create unique index if not exists notification_routes_unique_idx
  on public.notification_routes (event_code, target_kind, coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid));

insert into public.notification_routes (event_code, target_kind, role_id)
select 'warehouse_repair_started', 'role', r.id
from public.roles r
where r.code = 'storekeeper'
on conflict do nothing;

insert into public.notification_routes (event_code, target_kind, role_id)
values
  ('order_assigned', 'responsible', null),
  ('order_deadline_approaching', 'responsible', null),
  ('order_deadline_overdue', 'responsible', null)
on conflict do nothing;

create table if not exists public.order_deadline_flags (
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('approaching', 'overdue')),
  sent_at timestamptz not null default now(),
  primary key (order_id, kind)
);

insert into public.order_status_transitions (from_status_id, to_status_id, required_permission, sort_order)
select f.id, t.id, 'orders:change_status', v.sort_order
from (
  values
    ('received', 'diagnostics', 0),
    ('diagnostics', 'waiting_approval', 1),
    ('waiting_approval', 'repair', 2),
    ('repair', 'quality_check', 3),
    ('quality_check', 'ready', 4),
    ('ready', 'issued', 5),
    ('received', 'cancelled', 10),
    ('diagnostics', 'cancelled', 11),
    ('waiting_approval', 'cancelled', 12)
) as v(from_code, to_code, sort_order)
join public.reference_sets s on s.code = 'order_statuses'
join public.reference_items f on f.set_id = s.id and f.code = v.from_code
join public.reference_items t on t.set_id = s.id and t.code = v.to_code
on conflict (from_status_id, to_status_id) do nothing;

insert into public.order_transition_rules (transition_id, rule_code)
select tr.id, 'diagnostics_conclusion'
from public.order_status_transitions tr
join public.reference_items f on f.id = tr.from_status_id
join public.reference_items t on t.id = tr.to_status_id
join public.reference_sets s on s.id = f.set_id and s.code = 'order_statuses'
where f.code = 'diagnostics' and t.code = 'waiting_approval'
on conflict do nothing;

create or replace view public.order_list_items
with (security_invoker = true) as
select
  o.id,
  o.number,
  o.number_seq,
  o.customer_id,
  c.name as customer_name,
  o.device_id,
  o.serial_number,
  coalesce(brand.name, '') as device_brand,
  coalesce(model.name, '') as device_model,
  trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''))) as device_label,
  o.status_id,
  st.code as status_code,
  st.name as status_name,
  coalesce(meta.is_terminal, false) as is_terminal,
  o.responsible_id,
  coalesce(nullif(p.full_name, ''), p.email, '') as responsible_name,
  o.deadline,
  case
    when coalesce(meta.is_terminal, false) then 'closed'
    when o.deadline is null then 'none'
    when o.deadline < current_date then 'overdue'
    when o.deadline <= current_date + coalesce(
      ((select value ->> 'approaching_days' from public.app_settings where key = 'deadline')::integer),
      2
    ) then 'approaching'
    else 'normal'
  end as deadline_state,
  o.claimed_malfunction,
  o.created_at,
  o.updated_at
from public.orders o
join public.customers c on c.id = o.customer_id
join public.devices d on d.id = o.device_id
join public.reference_items st on st.id = o.status_id
left join public.order_status_meta meta on meta.status_id = o.status_id
left join public.profiles p on p.id = o.responsible_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id;

create or replace function public.next_order_number()
returns table (order_number text, seq integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_val integer;
  current_prefix text;
  current_pad integer;
begin
  update public.order_number_sequence
  set last_value = greatest(last_value, start_value - 1) + 1
  where id = 1
  returning last_value, prefix, pad_width into next_val, current_prefix, current_pad;

  if next_val is null then
    raise exception 'Не настроена нумерация заказов.';
  end if;

  order_number := current_prefix || '-' || lpad(next_val::text, current_pad, '0');
  seq := next_val;
  return next;
end;
$$;

create or replace function public.preview_next_order_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select prefix || '-' || lpad((greatest(last_value, start_value - 1) + 1)::text, pad_width, '0')
  from public.order_number_sequence
  where id = 1;
$$;

create or replace function public.set_order_number_start(next_start integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения нумерации.';
  end if;

  if next_start is null or next_start < 1 then
    raise exception 'Начальный номер должен быть больше нуля.';
  end if;

  update public.order_number_sequence
  set start_value = next_start
  where id = 1;

  update public.app_settings
  set value = jsonb_set(coalesce(value, '{}'::jsonb), '{start}', to_jsonb(next_start))
  where key = 'order_number';

  perform public.record_audit(
    'orders.number_start_changed',
    'settings',
    'order_number',
    jsonb_build_object('start', next_start)
  );
end;
$$;

create or replace function public.create_customer(
  customer_name text,
  customer_inn text default '',
  customer_phone text default '',
  customer_email text default '',
  customer_city text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  normalized_name text;
begin
  if not public.has_permission('customers:create') then
    raise exception 'Недостаточно прав для создания клиента.';
  end if;

  normalized_name := btrim(coalesce(customer_name, ''));
  if char_length(normalized_name) < 1 then
    raise exception 'Укажите название клиента.';
  end if;

  insert into public.customers (name, inn, phone, email, city)
  values (
    normalized_name,
    btrim(coalesce(customer_inn, '')),
    btrim(coalesce(customer_phone, '')),
    btrim(coalesce(customer_email, '')),
    btrim(coalesce(customer_city, ''))
  )
  returning id into result_id;

  perform public.record_audit('customers.created', 'customer', result_id::text, jsonb_build_object('name', normalized_name));
  return result_id;
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
    raise exception 'Прибор с таким серийным номером уже есть.';
end;
$$;

create or replace function public.fanout_notification(
  event_code text,
  title text,
  body text,
  entity_type text,
  entity_id text,
  source_order_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  route public.notification_routes%rowtype;
  responsible uuid;
begin
  for route in
    select * from public.notification_routes where notification_routes.event_code = fanout_notification.event_code
  loop
    if route.target_kind = 'role' and route.role_id is not null then
      insert into public.notifications (recipient_id, event_code, title, body, entity_type, entity_id)
      select ur.user_id, fanout_notification.event_code, title, body, entity_type, entity_id
      from public.user_roles ur
      join public.profiles p on p.id = ur.user_id
      where ur.role_id = route.role_id
        and p.is_active = true;
    elsif route.target_kind = 'responsible' and source_order_id is not null then
      select responsible_id into responsible from public.orders where id = source_order_id;
      if responsible is not null then
        insert into public.notifications (recipient_id, event_code, title, body, entity_type, entity_id)
        select responsible, fanout_notification.event_code, title, body, entity_type, entity_id
        from public.profiles p
        where p.id = responsible and p.is_active = true;
      end if;
    end if;
  end loop;
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
  if char_length(malfunction) < 1 then
    raise exception 'Укажите заявленную неисправность.';
  end if;

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
  change_responsible boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  previous_responsible uuid;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  if claimed_malfunction is not null or completeness is not null or external_condition is not null
     or target_deadline is not null or clear_deadline then
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

  previous_responsible := current_row.responsible_id;

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
    end
  where id = target_order_id;

  if change_responsible and target_responsible_id is distinct from previous_responsible then
    perform public.fanout_notification(
      'order_assigned',
      'Назначен заказ',
      'Вам назначен заказ ' || current_row.number,
      'order',
      target_order_id::text,
      target_order_id
    );
  end if;

  perform public.record_audit('orders.updated', 'order', target_order_id::text, '{}'::jsonb);
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
        and char_length(btrim(d.conclusion)) > 0
    );
  end if;

  if rule_code = 'responsible_assigned' then
    return target_order.responsible_id is not null;
  end if;

  return false;
end;
$$;

create or replace function public.change_order_status(target_order_id uuid, target_status_id uuid)
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
            reason := 'Нужно заключение диагностики.';
          elsif rule_code = 'responsible_assigned' then
            reason := 'Нужно назначить ответственного.';
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

create or replace function public.save_order_diagnostics(target_order_id uuid, conclusion text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('diagnostics:update') then
    raise exception 'Недостаточно прав для записи диагностики.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.order_diagnostics (order_id, conclusion, updated_by, updated_at)
  values (target_order_id, btrim(coalesce(conclusion, '')), auth.uid(), now())
  on conflict (order_id) do update
    set conclusion = excluded.conclusion,
        updated_by = excluded.updated_by,
        updated_at = now();

  perform public.record_audit('orders.diagnostics_saved', 'order', target_order_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.add_order_attachment_url(
  target_order_id uuid,
  target_url text,
  caption text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  normalized text;
begin
  if not (public.has_permission('orders:update') or public.has_permission('orders:create')) then
    raise exception 'Недостаточно прав для добавления файла.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  normalized := btrim(coalesce(target_url, ''));
  if normalized !~* '^https?://' then
    raise exception 'Укажите ссылку, начинающуюся с http:// или https://.';
  end if;

  insert into public.order_attachments (order_id, kind, url, caption, created_by)
  values (target_order_id, 'url', normalized, btrim(coalesce(caption, '')), auth.uid())
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.register_order_file(
  target_order_id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer,
  caption text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  kind text;
begin
  if not (public.has_permission('orders:update') or public.has_permission('orders:create')) then
    raise exception 'Недостаточно прав для добавления файла.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if file_path is null or split_part(file_path, '/', 1) <> target_order_id::text then
    raise exception 'Некорректный путь файла.';
  end if;

  if mime_type in ('image/jpeg', 'image/png', 'image/webp') then
    kind := 'photo';
  elsif mime_type = 'application/pdf' then
    kind := 'pdf';
  else
    raise exception 'Можно загрузить только фото или PDF. Видео добавляйте ссылкой.';
  end if;

  insert into public.order_attachments (
    order_id, kind, file_path, file_name, mime_type, file_size, caption, created_by
  )
  values (
    target_order_id, kind, file_path, file_name, mime_type, file_size, btrim(coalesce(caption, '')), auth.uid()
  )
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.upsert_order_transition(
  target_id uuid,
  from_status_id uuid,
  to_status_id uuid,
  required_permission text,
  rule_codes text[] default '{}',
  is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения маршрута.';
  end if;

  if from_status_id = to_status_id then
    raise exception 'Начальный и конечный статус не должны совпадать.';
  end if;

  if required_permission is null or required_permission not in (
    'orders:change_status', 'orders:update', 'diagnostics:update', 'orders:assign'
  ) then
    raise exception 'Некорректное право для перехода.';
  end if;

  if target_id is null then
    insert into public.order_status_transitions (
      from_status_id, to_status_id, required_permission, is_active
    )
    values (from_status_id, to_status_id, required_permission, coalesce(is_active, true))
    returning id into result_id;
  else
    update public.order_status_transitions
    set from_status_id = upsert_order_transition.from_status_id,
        to_status_id = upsert_order_transition.to_status_id,
        required_permission = upsert_order_transition.required_permission,
        is_active = coalesce(is_active, true)
    where id = target_id
    returning id into result_id;

    if result_id is null then
      raise exception 'Переход не найден.';
    end if;
  end if;

  delete from public.order_transition_rules where transition_id = result_id;
  insert into public.order_transition_rules (transition_id, rule_code)
  select result_id, r.code
  from unnest(coalesce(rule_codes, '{}'::text[])) as r(code)
  join public.transition_rule_types t on t.code = r.code;

  perform public.record_audit('orders.transition_saved', 'order_transition', result_id::text, '{}'::jsonb);
  return result_id;
exception
  when unique_violation then
    raise exception 'Такой переход уже существует.';
end;
$$;

create or replace function public.process_order_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  approaching_days integer := 2;
  sent integer := 0;
  rec record;
begin
  if auth.uid() is not null and not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав.';
  end if;

  select coalesce((value ->> 'approaching_days')::integer, 2)
    into approaching_days
  from public.app_settings
  where key = 'deadline';

  for rec in
    select o.id, o.number, o.deadline, o.responsible_id, meta.is_terminal
    from public.orders o
    left join public.order_status_meta meta on meta.status_id = o.status_id
    where o.deadline is not null
      and o.responsible_id is not null
      and coalesce(meta.is_terminal, false) = false
  loop
    if rec.deadline < current_date then
      if not exists (
        select 1 from public.order_deadline_flags f
        where f.order_id = rec.id and f.kind = 'overdue'
      ) then
        perform public.fanout_notification(
          'order_deadline_overdue',
          'Срок заказа просрочен',
          'Срок заказа ' || rec.number || ' истёк.',
          'order',
          rec.id::text,
          rec.id
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'overdue');
        sent := sent + 1;
      end if;
    elsif rec.deadline <= current_date + approaching_days then
      if not exists (
        select 1 from public.order_deadline_flags f
        where f.order_id = rec.id and f.kind = 'approaching'
      ) then
        perform public.fanout_notification(
          'order_deadline_approaching',
          'Приближается срок заказа',
          'Срок заказа ' || rec.number || ' — ' || to_char(rec.deadline, 'DD.MM.YYYY') || '.',
          'order',
          rec.id::text,
          rec.id
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'approaching');
        sent := sent + 1;
      end if;
    end if;
  end loop;

  return sent;
end;
$$;

create or replace function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
  set is_read = true
  where recipient_id = auth.uid() and is_read = false;
end;
$$;

create or replace function public.reference_item_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    (select count(*) from public.reference_items where parent_id = target_item_id) +
    (select count(*) from public.orders where status_id = target_item_id) +
    (select count(*) from public.devices where group_id = target_item_id or brand_id = target_item_id or model_id = target_item_id or modification_id = target_item_id)
  )::integer;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-attachments',
  'order-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists order_attachments_select on storage.objects;
create policy order_attachments_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'order-attachments' and public.has_permission('orders:read'));

drop policy if exists order_attachments_insert on storage.objects;
create policy order_attachments_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'order-attachments'
    and (public.has_permission('orders:create') or public.has_permission('orders:update'))
  );

drop policy if exists order_attachments_delete on storage.objects;
create policy order_attachments_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'order-attachments'
    and public.has_permission('orders:update')
  );

alter table public.app_settings enable row level security;
alter table public.order_number_sequence enable row level security;
alter table public.customers enable row level security;
alter table public.devices enable row level security;
alter table public.order_status_meta enable row level security;
alter table public.transition_rule_types enable row level security;
alter table public.order_status_transitions enable row level security;
alter table public.order_transition_rules enable row level security;
alter table public.orders enable row level security;
alter table public.order_status_events enable row level security;
alter table public.order_diagnostics enable row level security;
alter table public.order_attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_routes enable row level security;
alter table public.order_deadline_flags enable row level security;

create policy app_settings_select on public.app_settings
  for select to authenticated using (public.is_active_user());

create policy customers_select on public.customers
  for select to authenticated
  using (public.has_permission('customers:read') or public.has_permission('orders:read'));

create policy devices_select on public.devices
  for select to authenticated
  using (public.has_permission('devices:read') or public.has_permission('orders:read'));

create policy order_status_meta_select on public.order_status_meta
  for select to authenticated using (public.is_active_user());

create policy transition_rule_types_select on public.transition_rule_types
  for select to authenticated using (public.is_active_user());

create policy order_status_transitions_select on public.order_status_transitions
  for select to authenticated using (public.has_permission('orders:read') or public.has_permission('settings:read'));

create policy order_transition_rules_select on public.order_transition_rules
  for select to authenticated using (public.has_permission('orders:read') or public.has_permission('settings:read'));

create policy orders_select on public.orders
  for select to authenticated using (public.has_permission('orders:read'));

create policy order_status_events_select on public.order_status_events
  for select to authenticated using (public.has_permission('orders:read'));

create policy order_diagnostics_select on public.order_diagnostics
  for select to authenticated
  using (public.has_permission('diagnostics:read') or public.has_permission('orders:read'));

create policy order_attachments_select on public.order_attachments
  for select to authenticated using (public.has_permission('orders:read'));

create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_id = auth.uid());

create policy notification_routes_select on public.notification_routes
  for select to authenticated using (public.has_permission('settings:read'));

grant select on public.order_list_items to authenticated;

revoke all on function public.next_order_number() from public;
revoke all on function public.preview_next_order_number() from public;
revoke all on function public.set_order_number_start(integer) from public;
revoke all on function public.create_customer(text, text, text, text, text) from public;
revoke all on function public.create_device(text, uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.fanout_notification(text, text, text, text, text, uuid) from public;
revoke all on function public.create_order(uuid, uuid, text, text, text, date, uuid) from public;
revoke all on function public.update_order(uuid, text, text, text, date, boolean, uuid, boolean) from public;
revoke all on function public.transition_rule_passed(text, public.orders) from public;
revoke all on function public.change_order_status(uuid, uuid) from public;
revoke all on function public.get_available_order_transitions(uuid) from public;
revoke all on function public.save_order_diagnostics(uuid, text) from public;
revoke all on function public.add_order_attachment_url(uuid, text, text) from public;
revoke all on function public.register_order_file(uuid, text, text, text, integer, text) from public;
revoke all on function public.upsert_order_transition(uuid, uuid, uuid, text, text[], boolean) from public;
revoke all on function public.process_order_deadline_notifications() from public;
revoke all on function public.mark_notifications_read() from public;

grant execute on function public.preview_next_order_number() to authenticated;
grant execute on function public.set_order_number_start(integer) to authenticated;
grant execute on function public.create_customer(text, text, text, text, text) to authenticated;
grant execute on function public.create_device(text, uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.create_order(uuid, uuid, text, text, text, date, uuid) to authenticated;
grant execute on function public.update_order(uuid, text, text, text, date, boolean, uuid, boolean) to authenticated;
grant execute on function public.change_order_status(uuid, uuid) to authenticated;
grant execute on function public.get_available_order_transitions(uuid) to authenticated;
grant execute on function public.save_order_diagnostics(uuid, text) to authenticated;
grant execute on function public.add_order_attachment_url(uuid, text, text) to authenticated;
grant execute on function public.register_order_file(uuid, text, text, text, integer, text) to authenticated;
grant execute on function public.upsert_order_transition(uuid, uuid, uuid, text, text[], boolean) to authenticated;
grant execute on function public.process_order_deadline_notifications() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
