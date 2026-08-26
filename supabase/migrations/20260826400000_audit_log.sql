-- Неизменяемый журнал действий: IP, RLS только audit:read, постраничный список.

alter table public.audit_events
  add column if not exists ip_address text,
  add column if not exists user_agent text;

comment on table public.audit_events is 'Неизменяемый журнал действий. Правка и удаление запрещены.';
comment on column public.audit_events.actor_id is 'Пользователь, выполнивший действие (actor_user_id).';
comment on column public.audit_events.ip_address is 'IP клиента из заголовков запроса, если доступен.';
comment on column public.audit_events.user_agent is 'User-Agent клиента, если доступен.';

create index if not exists audit_events_action_created_idx
  on public.audit_events (action, created_at desc);

create index if not exists audit_events_actor_created_idx
  on public.audit_events (actor_id, created_at desc);

create index if not exists audit_events_entity_type_created_idx
  on public.audit_events (entity_type, created_at desc);

create index if not exists audit_events_ip_idx
  on public.audit_events (ip_address)
  where ip_address is not null;

create or replace function public.audit_request_headers()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  raw text;
begin
  begin
    raw := current_setting('request.headers', true);
  exception
    when others then
      return '{}'::jsonb;
  end;

  if raw is null or btrim(raw) = '' then
    return '{}'::jsonb;
  end if;

  begin
    return raw::jsonb;
  exception
    when others then
      return '{}'::jsonb;
  end;
end;
$$;

create or replace function public.audit_client_ip()
returns text
language plpgsql
set search_path = public
as $$
declare
  headers jsonb;
  forwarded text;
  ip text;
begin
  headers := public.audit_request_headers();
  forwarded := btrim(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1));
  ip := coalesce(
    nullif(forwarded, ''),
    nullif(btrim(coalesce(headers ->> 'x-real-ip', '')), ''),
    nullif(btrim(coalesce(headers ->> 'cf-connecting-ip', '')), '')
  );

  if ip is null then
    begin
      ip := host(inet_client_addr());
    exception
      when others then
        ip := null;
    end;
  end if;

  if ip is null or ip = '' then
    return null;
  end if;

  return left(ip, 64);
end;
$$;

create or replace function public.audit_client_user_agent()
returns text
language plpgsql
set search_path = public
as $$
declare
  ua text;
begin
  ua := btrim(coalesce(public.audit_request_headers() ->> 'user-agent', ''));
  if ua = '' then
    return null;
  end if;
  return left(ua, 512);
end;
$$;

create or replace function public.write_audit_event(
  actor_user_id uuid,
  action text,
  entity_type text,
  entity_id text default null,
  metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if btrim(coalesce(action, '')) = '' or btrim(coalesce(entity_type, '')) = '' then
    raise exception 'Некорректное событие аудита.';
  end if;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, metadata, ip_address, user_agent
  )
  values (
    actor_user_id,
    btrim(action),
    btrim(entity_type),
    nullif(btrim(coalesce(entity_id, '')), ''),
    coalesce(metadata, '{}'::jsonb),
    public.audit_client_ip(),
    public.audit_client_user_agent()
  );
end;
$$;

create or replace function public.record_audit(
  action text,
  entity_type text,
  entity_id text default null,
  metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.write_audit_event(
    auth.uid(),
    action,
    entity_type,
    entity_id,
    coalesce(metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.record_auth_event(event_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  action_code text := btrim(coalesce(event_action, ''));
begin
  if auth.uid() is null then
    raise exception 'Нельзя записать аудит без авторизации.';
  end if;

  if action_code not in ('auth.signed_in', 'auth.signed_out', 'auth.password_updated') then
    raise exception 'Неизвестное событие.';
  end if;

  perform public.record_audit(action_code, 'session', auth.uid()::text, '{}'::jsonb);
end;
$$;

create or replace function public.forbid_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Записи журнала нельзя изменять.';
end;
$$;

drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update
  before update or delete on public.audit_events
  for each row execute procedure public.forbid_audit_mutation();

drop policy if exists audit_events_insert_own on public.audit_events;
drop policy if exists audit_events_select_own_or_audit_read on public.audit_events;

create policy audit_events_select_audit_read
  on public.audit_events
  for select
  to authenticated
  using (public.has_permission('audit:read'));

revoke all on table public.audit_events from public, anon, authenticated;

create or replace function public.list_audit_events(
  search_query text default '',
  actor_filter uuid default null,
  entity_type_filter text default '',
  action_filter text default '',
  from_date date default null,
  to_date date default null,
  page_number integer default 1,
  page_size integer default 50
)
returns table (
  id uuid,
  actor_id uuid,
  actor_name text,
  actor_email text,
  action text,
  entity_type text,
  entity_id text,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  escaped text;
  entity_value text;
  action_value text;
  safe_page integer;
  safe_size integer;
  from_ts timestamptz;
  to_ts timestamptz;
begin
  if not public.has_permission('audit:read') then
    raise exception 'Недостаточно прав для просмотра журнала.';
  end if;

  entity_value := nullif(btrim(coalesce(entity_type_filter, '')), '');
  action_value := nullif(btrim(coalesce(action_filter, '')), '');
  term := nullif(btrim(coalesce(search_query, '')), '');
  if term is not null then
    escaped := replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_');
    term := '%' || escaped || '%';
  end if;

  if from_date is not null then
    from_ts := from_date::timestamp at time zone 'Europe/Moscow';
  end if;
  if to_date is not null then
    to_ts := (to_date + 1)::timestamp at time zone 'Europe/Moscow';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 50), 1), 50);

  return query
  select
    e.id,
    e.actor_id,
    case
      when e.actor_id is null then 'Система'
      else coalesce(nullif(btrim(p.full_name), ''), p.email, 'Пользователь')
    end as actor_name,
    coalesce(p.email, '') as actor_email,
    e.action,
    e.entity_type,
    e.entity_id,
    e.metadata,
    e.ip_address,
    e.user_agent,
    e.created_at,
    count(*) over () as total_count
  from public.audit_events e
  left join public.profiles p on p.id = e.actor_id
  where (actor_filter is null or e.actor_id = actor_filter)
    and (entity_value is null or e.entity_type = entity_value)
    and (action_value is null or e.action = action_value)
    and (from_ts is null or e.created_at >= from_ts)
    and (to_ts is null or e.created_at < to_ts)
    and (
      term is null
      or e.action ilike term escape '\'
      or e.entity_type ilike term escape '\'
      or coalesce(e.entity_id, '') ilike term escape '\'
      or coalesce(p.full_name, '') ilike term escape '\'
      or coalesce(p.email, '') ilike term escape '\'
      or coalesce(e.ip_address, '') ilike term escape '\'
    )
  order by e.created_at desc, e.id desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.list_active_employees()
returns table (id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('users:read')
    or public.has_permission('orders:read')
    or public.has_permission('orders:create')
    or public.has_permission('orders:assign')
    or public.has_permission('tasks:read')
    or public.has_permission('tasks:create')
    or public.has_permission('tasks:update')
    or public.has_permission('audit:read')
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  return query
  select p.id, p.full_name, p.email
  from public.profiles p
  where p.is_active = true
  order by p.full_name, p.email;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.invitations%rowtype;
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when profiles.full_name = '' then excluded.full_name
          else profiles.full_name
        end;

  select *
    into invitation
  from public.invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
  order by created_at desc
  limit 1;

  if invitation.id is not null then
    insert into public.user_roles (user_id, role_id, assigned_by)
    values (new.id, invitation.role_id, invitation.invited_by)
    on conflict (user_id) do nothing;

    update public.invitations
    set status = 'accepted',
        accepted_at = now(),
        auth_user_id = new.id
    where id = invitation.id;

    perform public.write_audit_event(
      invitation.invited_by,
      'users.invite_accepted',
      'invitation',
      invitation.id::text,
      jsonb_build_object('user_id', new.id, 'email', new.email)
    );
  end if;

  return new;
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
  field_changed boolean;
  assigned boolean;
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
  field_changed := claimed_malfunction is not null
    or completeness is not null
    or external_condition is not null
    or target_deadline is not null
    or clear_deadline;
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

create or replace function public.delete_document_template(target_template_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.document_templates%rowtype;
begin
  perform public.assert_templates_edit();

  select * into current_row
  from public.document_templates
  where id = target_template_id
  for update;

  if current_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  if current_row.is_system then
    raise exception 'Системный шаблон нельзя удалить.';
  end if;

  if exists (select 1 from public.documents where template_id = target_template_id) then
    raise exception 'Шаблон уже использован в документах.';
  end if;

  delete from public.document_templates
  where id = target_template_id;

  perform public.record_audit(
    'document.template_deactivated',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', current_row.name)
  );
end;
$$;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'audit:read'
where r.code = 'manager'
on conflict do nothing;

revoke all on function public.audit_request_headers() from public, anon, authenticated;
revoke all on function public.audit_client_ip() from public, anon, authenticated;
revoke all on function public.audit_client_user_agent() from public, anon, authenticated;
revoke all on function public.write_audit_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_audit(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_auth_event(text) from public, anon, authenticated;
revoke all on function public.forbid_audit_mutation() from public, anon, authenticated;
revoke all on function public.list_audit_events(text, uuid, text, text, date, date, integer, integer) from public, anon, authenticated;

grant execute on function public.record_auth_event(text) to authenticated;
grant execute on function public.list_audit_events(text, uuid, text, text, date, date, integer, integer) to authenticated;
