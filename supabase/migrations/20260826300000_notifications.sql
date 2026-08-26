-- Эндотека: событийные уведомления.
-- Действие → domain_events → обработка → in-app / email / telegram.
-- Сбой доставки не откатывает заказ и другие бизнес-операции.

create table if not exists public.notification_event_catalog (
  code text primary key,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_system boolean not null default true
);

insert into public.notification_event_catalog (code, name, description, sort_order)
values
  ('responsible_assigned', 'Назначение ответственного', 'Ответственный сотрудник назначен на заказ.', 0),
  ('task_assigned', 'Назначение задачи', 'Сотруднику назначена задача.', 1),
  ('order_status_changed', 'Смена статуса заказа', 'Статус заказа изменился.', 2),
  ('deadline_approaching', 'Приближается срок', 'Срок заказа скоро истечёт.', 3),
  ('deadline_overdue', 'Срок просрочен', 'Срок заказа истёк.', 4),
  ('order_in_repair', 'Заказ в ремонте', 'Заказ переведён в ремонт, склад может понадобиться.', 5)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

update public.reference_items i
set is_active = false
from public.reference_sets s
where s.code = 'notification_event_types'
  and i.set_id = s.id
  and i.code in (
    'order_assigned',
    'task_due',
    'inventory_low',
    'warehouse_repair_started',
    'order_deadline_approaching',
    'order_deadline_overdue'
  );

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, c.code, c.name, c.sort_order, true
from public.reference_sets s
join public.notification_event_catalog c on true
where s.code = 'notification_event_types'
on conflict do nothing;

alter table if exists public.notifications rename to notifications_legacy;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  title text not null,
  body text not null,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notifications_created_at_idx
  on public.notifications (created_at desc);

create index if not exists notifications_event_idx
  on public.notifications (event_code, created_at desc);

create table if not exists public.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_recipients_read_at_check check (
    (is_read and read_at is not null) or (not is_read and read_at is null)
  )
);

create unique index if not exists notification_recipients_unique_idx
  on public.notification_recipients (notification_id, recipient_id);

create index if not exists notification_recipients_unread_idx
  on public.notification_recipients (recipient_id, created_at desc)
  where is_read = false;

insert into public.notifications (id, event_code, title, body, entity_type, entity_id, created_at)
select id, event_code, title, body, entity_type, entity_id, created_at
from public.notifications_legacy
on conflict (id) do nothing;

insert into public.notification_recipients (notification_id, recipient_id, is_read, read_at, created_at)
select
  id,
  recipient_id,
  is_read,
  case when is_read then created_at else null end,
  created_at
from public.notifications_legacy
on conflict do nothing;

drop table if exists public.notifications_legacy;

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  process_error text
);

create index if not exists domain_events_pending_idx
  on public.domain_events (created_at)
  where processed_at is null;

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  target_kind text not null check (target_kind in ('role', 'responsible', 'assignee')),
  role_id uuid references public.roles (id) on delete cascade,
  channel_in_app boolean not null default true,
  channel_email boolean not null default false,
  channel_telegram boolean not null default false,
  is_active boolean not null default true,
  constraint notification_rules_role_required check (
    (target_kind = 'role' and role_id is not null)
    or (target_kind <> 'role' and role_id is null)
  )
);

create unique index if not exists notification_rules_unique_idx
  on public.notification_rules (
    event_code,
    target_kind,
    coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

insert into public.notification_rules (event_code, target_kind, role_id, channel_in_app)
select
  case r.event_code
    when 'warehouse_repair_started' then 'order_in_repair'
    when 'order_assigned' then 'responsible_assigned'
    when 'order_deadline_approaching' then 'deadline_approaching'
    when 'order_deadline_overdue' then 'deadline_overdue'
    else r.event_code
  end,
  r.target_kind,
  r.role_id,
  true
from public.notification_routes r
on conflict do nothing;

insert into public.notification_rules (event_code, target_kind, role_id, channel_in_app)
values
  ('responsible_assigned', 'responsible', null, true),
  ('task_assigned', 'assignee', null, true),
  ('order_status_changed', 'responsible', null, true),
  ('deadline_approaching', 'responsible', null, true),
  ('deadline_overdue', 'responsible', null, true)
on conflict do nothing;

insert into public.notification_rules (event_code, target_kind, role_id, channel_in_app)
select 'order_in_repair', 'role', r.id, true
from public.roles r
where r.code = 'storekeeper'
on conflict do nothing;

drop table if exists public.notification_routes;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('email', 'telegram')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  error text,
  sent_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (status, created_at)
  where status = 'pending';

create index if not exists notification_deliveries_failed_idx
  on public.notification_deliveries (created_at desc)
  where status = 'failed';

create table if not exists public.telegram_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  chat_id text,
  telegram_username text,
  link_code text,
  link_code_expires_at timestamptz,
  linked_at timestamptz,
  constraint telegram_links_chat_or_code check (chat_id is not null or link_code is not null)
);

create unique index if not exists telegram_links_chat_unique_idx
  on public.telegram_links (chat_id)
  where chat_id is not null;

create unique index if not exists telegram_links_code_unique_idx
  on public.telegram_links (link_code)
  where link_code is not null;

insert into public.app_settings (key, value)
values (
  'notifications',
  jsonb_build_object(
    'email_enabled', false,
    'from_name', 'Эндотека',
    'from_email', '',
    'telegram_enabled', false,
    'telegram_bot_username', ''
  )
)
on conflict (key) do nothing;

create or replace function public.notification_channel_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select value
      from public.app_settings
      where key = 'notifications'
    ),
    jsonb_build_object(
      'email_enabled', false,
      'from_name', 'Эндотека',
      'from_email', '',
      'telegram_enabled', false,
      'telegram_bot_username', ''
    )
  );
$$;

create or replace function public.assert_notification_settings_read()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:read') then
    raise exception 'Недостаточно прав для настроек уведомлений.';
  end if;
end;
$$;

create or replace function public.assert_notification_settings_update()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения правил уведомлений.';
  end if;
end;
$$;

create or replace function public.assert_service_role()
returns void
language plpgsql
stable
as $$
begin
  if auth.uid() is not null then
    raise exception 'Только служебный вызов.';
  end if;
end;
$$;

create or replace function public.collect_event_recipients(event_payload jsonb, p_event_code text)
returns table (recipient_id uuid, channel_in_app boolean, channel_email boolean, channel_telegram boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid;
  order_uuid uuid;
  task_uuid uuid;
  responsible uuid;
  assignee uuid;
begin
  actor := nullif(event_payload ->> 'actor_id', '')::uuid;
  order_uuid := nullif(event_payload ->> 'order_id', '')::uuid;
  task_uuid := nullif(event_payload ->> 'task_id', '')::uuid;

  if order_uuid is not null then
    select o.responsible_id into responsible from public.orders o where o.id = order_uuid;
  end if;
  if responsible is null and nullif(event_payload ->> 'responsible_id', '') is not null then
    responsible := (event_payload ->> 'responsible_id')::uuid;
  end if;

  if task_uuid is not null then
    select t.assignee_id into assignee from public.tasks t where t.id = task_uuid;
  end if;
  if assignee is null and nullif(event_payload ->> 'assignee_id', '') is not null then
    assignee := (event_payload ->> 'assignee_id')::uuid;
  end if;

  return query
  with resolved as (
    select
      case
        when r.target_kind = 'role' then ur.user_id
        when r.target_kind = 'responsible' then responsible
        when r.target_kind = 'assignee' then assignee
      end as user_id,
      r.channel_in_app,
      r.channel_email,
      r.channel_telegram
    from public.notification_rules r
    left join public.user_roles ur on r.target_kind = 'role' and ur.role_id = r.role_id
    where r.is_active = true
      and r.event_code = p_event_code
  )
  select
    resolved.user_id,
    bool_or(resolved.channel_in_app) as channel_in_app,
    bool_or(resolved.channel_email) as channel_email,
    bool_or(resolved.channel_telegram) as channel_telegram
  from resolved
  join public.profiles p on p.id = resolved.user_id
  where resolved.user_id is not null
    and p.is_active = true
    and resolved.user_id is distinct from actor
  group by resolved.user_id;
end;
$$;

create or replace function public.process_domain_event(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.domain_events%rowtype;
  notification_id uuid;
  title_value text;
  body_value text;
  rec record;
  settings jsonb;
  email_on boolean;
  telegram_on boolean;
  has_any boolean := false;
begin
  select * into event_row
  from public.domain_events
  where id = target_event_id
  for update;

  if event_row.id is null then
    return;
  end if;

  if event_row.processed_at is not null then
    return;
  end if;

  settings := public.notification_channel_settings();
  email_on := coalesce((settings ->> 'email_enabled')::boolean, false);
  telegram_on := coalesce((settings ->> 'telegram_enabled')::boolean, false);

  title_value := coalesce(nullif(btrim(event_row.payload ->> 'title'), ''), 'Уведомление');
  body_value := coalesce(nullif(btrim(event_row.payload ->> 'body'), ''), '');

  for rec in
    select * from public.collect_event_recipients(event_row.payload, event_row.event_code)
  loop
    if not has_any then
      insert into public.notifications (event_code, title, body, entity_type, entity_id, payload)
      values (
        event_row.event_code,
        title_value,
        body_value,
        event_row.entity_type,
        event_row.entity_id,
        event_row.payload
      )
      returning id into notification_id;
      has_any := true;
    end if;

    if rec.channel_in_app then
      insert into public.notification_recipients (notification_id, recipient_id)
      values (notification_id, rec.recipient_id)
      on conflict do nothing;
    end if;

    if rec.channel_email and email_on then
      insert into public.notification_deliveries (notification_id, recipient_id, channel)
      values (notification_id, rec.recipient_id, 'email');
    end if;

    if rec.channel_telegram and telegram_on then
      insert into public.notification_deliveries (notification_id, recipient_id, channel)
      values (notification_id, rec.recipient_id, 'telegram');
    end if;
  end loop;

  update public.domain_events
  set processed_at = now(),
      process_error = null
  where id = target_event_id;
end;
$$;

create or replace function public.emit_domain_event(
  event_code text,
  entity_type text,
  entity_id text,
  payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
  code_value text := btrim(coalesce(event_code, ''));
begin
  if code_value = '' then
    return null;
  end if;

  insert into public.domain_events (event_code, entity_type, entity_id, payload, actor_id)
  values (
    code_value,
    entity_type,
    entity_id,
    coalesce(payload, '{}'::jsonb),
    coalesce(nullif(payload ->> 'actor_id', '')::uuid, auth.uid())
  )
  returning id into event_id;

  begin
    perform public.process_domain_event(event_id);
  exception
    when others then
      update public.domain_events
      set process_error = left(sqlerrm, 500)
      where id = event_id;
  end;

  return event_id;
exception
  when others then
    return null;
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
  mapped text;
begin
  mapped := case event_code
    when 'warehouse_repair_started' then 'order_in_repair'
    when 'order_assigned' then 'responsible_assigned'
    when 'order_deadline_approaching' then 'deadline_approaching'
    when 'order_deadline_overdue' then 'deadline_overdue'
    else event_code
  end;

  perform public.emit_domain_event(
    mapped,
    entity_type,
    entity_id,
    jsonb_build_object(
      'title', title,
      'body', body,
      'actor_id', auth.uid(),
      'order_id', source_order_id
    )
  );
end;
$$;

create or replace function public.process_pending_domain_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  processed integer := 0;
begin
  perform public.assert_service_role();

  for rec in
    select id from public.domain_events
    where processed_at is null
    order by created_at
    limit 50
  loop
    begin
      perform public.process_domain_event(rec.id);
      processed := processed + 1;
    exception
      when others then
        update public.domain_events
        set process_error = left(sqlerrm, 500)
        where id = rec.id;
    end;
  end loop;

  return processed;
end;
$$;

create or replace function public.list_my_notifications(page_size integer default 30)
returns table (
  id uuid,
  event_code text,
  title text,
  body text,
  entity_type text,
  entity_id text,
  is_read boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_size integer;
begin
  if not public.has_permission('notifications:read') then
    raise exception 'Недостаточно прав для уведомлений.';
  end if;

  safe_size := least(greatest(coalesce(page_size, 30), 1), 100);

  return query
  select
    n.id,
    n.event_code,
    n.title,
    n.body,
    n.entity_type,
    n.entity_id,
    r.is_read,
    n.created_at
  from public.notification_recipients r
  join public.notifications n on n.id = r.notification_id
  where r.recipient_id = auth.uid()
  order by n.created_at desc
  limit safe_size;
end;
$$;

create or replace function public.count_unread_notifications()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result bigint;
begin
  if not public.has_permission('notifications:read') then
    raise exception 'Недостаточно прав для уведомлений.';
  end if;

  select count(*) into result
  from public.notification_recipients
  where recipient_id = auth.uid() and is_read = false;

  return coalesce(result, 0);
end;
$$;

create or replace function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('notifications:read') then
    raise exception 'Недостаточно прав для уведомлений.';
  end if;

  update public.notification_recipients
  set is_read = true,
      read_at = now()
  where recipient_id = auth.uid()
    and is_read = false;
end;
$$;

create or replace function public.mark_notification_read(target_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('notifications:read') then
    raise exception 'Недостаточно прав для уведомлений.';
  end if;

  update public.notification_recipients
  set is_read = true,
      read_at = now()
  where recipient_id = auth.uid()
    and notification_id = target_notification_id
    and is_read = false;
end;
$$;

create or replace function public.list_notification_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_notification_settings_read();

  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code,
        'name', c.name,
        'description', c.description
      ) order by c.sort_order, c.name)
      from public.notification_event_catalog c
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'code', r.code,
        'name', r.name
      ) order by r.name)
      from public.roles r
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id,
        'event_code', n.event_code,
        'target_kind', n.target_kind,
        'role_id', n.role_id,
        'role_name', r.name,
        'channel_in_app', n.channel_in_app,
        'channel_email', n.channel_email,
        'channel_telegram', n.channel_telegram,
        'is_active', n.is_active
      ) order by n.event_code, n.target_kind)
      from public.notification_rules n
      left join public.roles r on r.id = n.role_id
    ), '[]'::jsonb),
    'channels', public.notification_channel_settings(),
    'failed_deliveries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'channel', d.channel,
        'status', d.status,
        'error', d.error,
        'attempts', d.attempts,
        'title', n.title,
        'recipient_name', coalesce(p.full_name, p.email, ''),
        'created_at', d.created_at
      ) order by d.created_at desc)
      from (
        select * from public.notification_deliveries
        where status = 'failed'
        order by created_at desc
        limit 30
      ) d
      join public.notifications n on n.id = d.notification_id
      join public.profiles p on p.id = d.recipient_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_notification_rule(
  target_id uuid,
  p_event_code text,
  p_target_kind text,
  p_role_id uuid default null,
  p_channel_in_app boolean default true,
  p_channel_email boolean default false,
  p_channel_telegram boolean default false,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  event_value text := btrim(coalesce(p_event_code, ''));
  kind_value text := btrim(coalesce(p_target_kind, ''));
begin
  perform public.assert_notification_settings_update();

  if not exists (select 1 from public.notification_event_catalog where code = event_value) then
    raise exception 'Неизвестное событие.';
  end if;

  if kind_value not in ('role', 'responsible', 'assignee') then
    raise exception 'Неизвестный получатель.';
  end if;

  if kind_value = 'role' then
    if p_role_id is null or not exists (select 1 from public.roles where id = p_role_id) then
      raise exception 'Укажите роль.';
    end if;
  else
    p_role_id := null;
  end if;

  if target_id is null then
    insert into public.notification_rules (
      event_code, target_kind, role_id, channel_in_app, channel_email, channel_telegram, is_active
    )
    values (
      event_value, kind_value, p_role_id,
      coalesce(p_channel_in_app, true),
      coalesce(p_channel_email, false),
      coalesce(p_channel_telegram, false),
      coalesce(p_is_active, true)
    )
    returning id into result_id;
  else
    update public.notification_rules
    set event_code = event_value,
        target_kind = kind_value,
        role_id = p_role_id,
        channel_in_app = coalesce(p_channel_in_app, true),
        channel_email = coalesce(p_channel_email, false),
        channel_telegram = coalesce(p_channel_telegram, false),
        is_active = coalesce(p_is_active, true)
    where id = target_id
    returning id into result_id;

    if result_id is null then
      raise exception 'Правило не найдено.';
    end if;
  end if;

  perform public.record_audit(
    'notifications.rule_saved',
    'notification_rule',
    result_id::text,
    jsonb_build_object('event_code', event_value, 'target_kind', kind_value)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Такое правило уже есть.';
end;
$$;

create or replace function public.delete_notification_rule(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_notification_settings_update();

  delete from public.notification_rules where id = target_id;
  if not found then
    raise exception 'Правило не найдено.';
  end if;

  perform public.record_audit('notifications.rule_deleted', 'notification_rule', target_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.save_notification_channel_settings(
  p_email_enabled boolean,
  p_from_name text,
  p_from_email text,
  p_telegram_enabled boolean,
  p_telegram_bot_username text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  from_email text := btrim(coalesce(p_from_email, ''));
  bot_name text := btrim(coalesce(p_telegram_bot_username, ''));
begin
  perform public.assert_notification_settings_update();

  if bot_name like '@%' then
    bot_name := substr(bot_name, 2);
  end if;

  insert into public.app_settings (key, value)
  values (
    'notifications',
    jsonb_build_object(
      'email_enabled', coalesce(p_email_enabled, false),
      'from_name', coalesce(nullif(btrim(p_from_name), ''), 'Эндотека'),
      'from_email', from_email,
      'telegram_enabled', coalesce(p_telegram_enabled, false),
      'telegram_bot_username', bot_name
    )
  )
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now();

  perform public.record_audit('notifications.channels_saved', 'app_settings', 'notifications', '{}'::jsonb);
end;
$$;

create or replace function public.claim_notification_deliveries(batch_size integer default 20)
returns table (
  id uuid,
  channel text,
  title text,
  body text,
  email text,
  chat_id text,
  recipient_name text,
  from_name text,
  from_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  settings jsonb;
  safe_size integer;
begin
  perform public.assert_service_role();
  settings := public.notification_channel_settings();
  safe_size := least(greatest(coalesce(batch_size, 20), 1), 50);

  return query
  with picked as (
    select d.id
    from public.notification_deliveries d
    where d.status = 'pending'
      and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
    order by d.created_at
    limit safe_size
    for update skip locked
  ),
  marked as (
    update public.notification_deliveries d
    set attempts = d.attempts + 1,
        claimed_at = now()
    from picked
    where d.id = picked.id
    returning d.id, d.channel, d.notification_id, d.recipient_id
  )
  select
    m.id,
    m.channel,
    n.title,
    n.body,
    p.email,
    t.chat_id,
    coalesce(p.full_name, p.email, ''),
    coalesce(settings ->> 'from_name', 'Эндотека'),
    coalesce(settings ->> 'from_email', '')
  from marked m
  join public.notifications n on n.id = m.notification_id
  join public.profiles p on p.id = m.recipient_id
  left join public.telegram_links t on t.user_id = m.recipient_id;
end;
$$;

create or replace function public.record_notification_delivery(
  target_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_service_role();

  if p_status not in ('sent', 'failed') then
    raise exception 'Неизвестный статус доставки.';
  end if;

  update public.notification_deliveries
  set status = p_status,
      error = case when p_status = 'failed' then left(coalesce(p_error, ''), 500) else null end,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = target_id;
end;
$$;

create or replace function public.get_my_telegram_link()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  settings jsonb := public.notification_channel_settings();
  link public.telegram_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Требуется вход.';
  end if;

  select * into link from public.telegram_links where user_id = auth.uid();

  return jsonb_build_object(
    'bot_username', coalesce(settings ->> 'telegram_bot_username', ''),
    'telegram_enabled', coalesce((settings ->> 'telegram_enabled')::boolean, false),
    'linked', link.chat_id is not null,
    'telegram_username', coalesce(link.telegram_username, ''),
    'pending_code', case
      when link.link_code is not null and link.link_code_expires_at > now() then link.link_code
      else ''
    end,
    'pending_expires_at', link.link_code_expires_at
  );
end;
$$;

create or replace function public.create_telegram_link_code()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
begin
  if auth.uid() is null then
    raise exception 'Требуется вход.';
  end if;

  insert into public.telegram_links (user_id, link_code, link_code_expires_at, chat_id, telegram_username, linked_at)
  values (auth.uid(), code, now() + interval '15 minutes', null, null, null)
  on conflict (user_id) do update
    set link_code = excluded.link_code,
        link_code_expires_at = excluded.link_code_expires_at,
        chat_id = public.telegram_links.chat_id,
        telegram_username = public.telegram_links.telegram_username,
        linked_at = public.telegram_links.linked_at;

  return public.get_my_telegram_link();
end;
$$;

create or replace function public.unlink_telegram()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется вход.';
  end if;

  delete from public.telegram_links where user_id = auth.uid();
end;
$$;

create or replace function public.confirm_telegram_link(
  p_code text,
  p_chat_id text,
  p_username text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  code_value text := upper(btrim(coalesce(p_code, '')));
  chat_value text := btrim(coalesce(p_chat_id, ''));
  updated_id uuid;
begin
  perform public.assert_service_role();

  if code_value = '' or chat_value = '' then
    return false;
  end if;

  update public.telegram_links
  set chat_id = chat_value,
      telegram_username = nullif(btrim(coalesce(p_username, '')), ''),
      linked_at = now(),
      link_code = null,
      link_code_expires_at = null
  where link_code = code_value
    and link_code_expires_at > now()
  returning user_id into updated_id;

  return updated_id is not null;
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

  if target_responsible_id is not null then
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
  end if;

  perform public.record_audit('orders.updated', 'order', target_order_id::text, '{}'::jsonb);
end;
$$;

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

create or replace function public.create_task(
  p_title text,
  p_body text default '',
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_priority text default 'normal',
  p_order_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  title_value text := btrim(coalesce(p_title, ''));
  body_value text := coalesce(p_body, '');
  priority_value text := coalesce(nullif(btrim(p_priority), ''), 'normal');
  order_number text;
begin
  perform public.assert_tasks_create();

  if title_value = '' then
    raise exception 'Укажите задачу.';
  end if;

  if priority_value not in ('low', 'normal', 'high') then
    raise exception 'Неизвестный приоритет.';
  end if;

  if p_assignee_id is not null and not exists (select 1 from public.profiles where id = p_assignee_id) then
    raise exception 'Сотрудник не найден.';
  end if;

  if p_order_id is not null and not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.tasks (
    title, body, assignee_id, due_date, priority, order_id, created_by
  )
  values (
    title_value, body_value, p_assignee_id, p_due_date, priority_value, p_order_id, auth.uid()
  )
  returning id into result_id;

  if p_order_id is not null then
    perform public.write_task_order_journal(
      p_order_id,
      'task_created',
      'Создана задача «' || left(title_value, 120) || '»',
      jsonb_build_object('task_id', result_id, 'title', title_value)
    );
  end if;

  perform public.record_audit(
    'task.created',
    'task',
    result_id::text,
    jsonb_build_object('title', title_value, 'order_id', p_order_id)
  );

  if p_assignee_id is not null then
    select number into order_number from public.orders where id = p_order_id;
    perform public.emit_domain_event(
      'task_assigned',
      'task',
      result_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'task_id', result_id,
        'task_title', title_value,
        'assignee_id', p_assignee_id,
        'order_id', p_order_id,
        'order_number', order_number,
        'title', 'Назначена задача',
        'body', 'Вам назначена задача «' || left(title_value, 120) || '»'
          || case when order_number is not null then ' (заказ ' || order_number || ')' else '' end
      )
    );
  end if;

  return result_id;
end;
$$;

create or replace function public.update_task(
  target_task_id uuid,
  p_title text,
  p_body text default '',
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_priority text default 'normal'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.tasks%rowtype;
  title_value text := btrim(coalesce(p_title, ''));
  body_value text := coalesce(p_body, '');
  priority_value text := coalesce(nullif(btrim(p_priority), ''), 'normal');
  order_number text;
begin
  perform public.assert_tasks_update();

  select * into current_row
  from public.tasks
  where id = target_task_id
  for update;

  if current_row.id is null then
    raise exception 'Задача не найдена.';
  end if;

  if title_value = '' then
    raise exception 'Укажите задачу.';
  end if;

  if priority_value not in ('low', 'normal', 'high') then
    raise exception 'Неизвестный приоритет.';
  end if;

  if p_assignee_id is not null and not exists (select 1 from public.profiles where id = p_assignee_id) then
    raise exception 'Сотрудник не найден.';
  end if;

  update public.tasks
  set title = title_value,
      body = body_value,
      assignee_id = p_assignee_id,
      due_date = p_due_date,
      priority = priority_value
  where id = target_task_id;

  perform public.record_audit(
    'task.updated',
    'task',
    target_task_id::text,
    jsonb_build_object('title', title_value)
  );

  if p_assignee_id is not null and p_assignee_id is distinct from current_row.assignee_id then
    select number into order_number from public.orders where id = current_row.order_id;
    perform public.emit_domain_event(
      'task_assigned',
      'task',
      target_task_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'task_id', target_task_id,
        'task_title', title_value,
        'assignee_id', p_assignee_id,
        'order_id', current_row.order_id,
        'order_number', order_number,
        'title', 'Назначена задача',
        'body', 'Вам назначена задача «' || left(title_value, 120) || '»'
          || case when order_number is not null then ' (заказ ' || order_number || ')' else '' end
      )
    );
  end if;
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
        perform public.emit_domain_event(
          'deadline_overdue',
          'order',
          rec.id::text,
          jsonb_build_object(
            'order_id', rec.id,
            'order_number', rec.number,
            'responsible_id', rec.responsible_id,
            'title', 'Срок заказа просрочен',
            'body', 'Срок заказа ' || rec.number || ' истёк.'
          )
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'overdue');
        sent := sent + 1;
      end if;
    elsif rec.deadline <= current_date + approaching_days then
      if not exists (
        select 1 from public.order_deadline_flags f
        where f.order_id = rec.id and f.kind = 'approaching'
      ) then
        perform public.emit_domain_event(
          'deadline_approaching',
          'order',
          rec.id::text,
          jsonb_build_object(
            'order_id', rec.id,
            'order_number', rec.number,
            'responsible_id', rec.responsible_id,
            'title', 'Приближается срок заказа',
            'body', 'Срок заказа ' || rec.number || ' — ' || to_char(rec.deadline, 'DD.MM.YYYY') || '.'
          )
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'approaching');
        sent := sent + 1;
      end if;
    end if;
  end loop;

  return sent;
end;
$$;

alter table public.notifications enable row level security;
alter table public.notification_recipients enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_event_catalog enable row level security;
alter table public.domain_events enable row level security;
alter table public.telegram_links enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using (
    exists (
      select 1 from public.notification_recipients r
      where r.notification_id = notifications.id and r.recipient_id = auth.uid()
    )
    or public.has_permission('settings:read')
  );

drop policy if exists notification_recipients_select_own on public.notification_recipients;
create policy notification_recipients_select_own
  on public.notification_recipients
  for select
  to authenticated
  using (recipient_id = auth.uid() or public.has_permission('settings:read'));

drop policy if exists notification_rules_select on public.notification_rules;
create policy notification_rules_select
  on public.notification_rules
  for select
  to authenticated
  using (public.has_permission('settings:read'));

drop policy if exists notification_deliveries_select on public.notification_deliveries;
create policy notification_deliveries_select
  on public.notification_deliveries
  for select
  to authenticated
  using (public.has_permission('settings:read'));

drop policy if exists notification_event_catalog_select on public.notification_event_catalog;
create policy notification_event_catalog_select
  on public.notification_event_catalog
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists telegram_links_select_own on public.telegram_links;
create policy telegram_links_select_own
  on public.telegram_links
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.notifications to authenticated;
grant select on public.notification_recipients to authenticated;
grant select on public.notification_rules to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select on public.notification_event_catalog to authenticated;
grant select on public.telegram_links to authenticated;

revoke all on function public.notification_channel_settings() from public;
revoke all on function public.assert_notification_settings_read() from public;
revoke all on function public.assert_notification_settings_update() from public;
revoke all on function public.assert_service_role() from public;
revoke all on function public.collect_event_recipients(jsonb, text) from public;
revoke all on function public.process_domain_event(uuid) from public;
revoke all on function public.emit_domain_event(text, text, text, jsonb) from public;
revoke all on function public.process_pending_domain_events() from public;
revoke all on function public.list_my_notifications(integer) from public;
revoke all on function public.count_unread_notifications() from public;
revoke all on function public.mark_notifications_read() from public;
revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.list_notification_admin() from public;
revoke all on function public.upsert_notification_rule(uuid, text, text, uuid, boolean, boolean, boolean, boolean) from public;
revoke all on function public.delete_notification_rule(uuid) from public;
revoke all on function public.save_notification_channel_settings(boolean, text, text, boolean, text) from public;
revoke all on function public.claim_notification_deliveries(integer) from public;
revoke all on function public.record_notification_delivery(uuid, text, text) from public;
revoke all on function public.get_my_telegram_link() from public;
revoke all on function public.create_telegram_link_code() from public;
revoke all on function public.unlink_telegram() from public;
revoke all on function public.confirm_telegram_link(text, text, text) from public;

grant execute on function public.list_my_notifications(integer) to authenticated;
grant execute on function public.count_unread_notifications() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.list_notification_admin() to authenticated;
grant execute on function public.upsert_notification_rule(uuid, text, text, uuid, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.delete_notification_rule(uuid) to authenticated;
grant execute on function public.save_notification_channel_settings(boolean, text, text, boolean, text) to authenticated;
grant execute on function public.get_my_telegram_link() to authenticated;
grant execute on function public.create_telegram_link_code() to authenticated;
grant execute on function public.unlink_telegram() to authenticated;

do $$
begin
  grant execute on function public.process_pending_domain_events() to service_role;
  grant execute on function public.claim_notification_deliveries(integer) to service_role;
  grant execute on function public.record_notification_delivery(uuid, text, text) to service_role;
  grant execute on function public.confirm_telegram_link(text, text, text) to service_role;
exception
  when undefined_object then
    null;
end;
$$;
