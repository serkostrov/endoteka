-- Статусы заказов: группы с цветом, флаги, каталог в настройках.

create table if not exists public.order_status_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  color text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint order_status_groups_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint order_status_groups_color_format check (color ~ '^#[0-9A-Fa-f]{6}$')
);

insert into public.order_status_groups (code, name, color, sort_order)
values
  ('new', 'Новые', '#2563eb', 0),
  ('in_progress', 'В работе', '#16a34a', 1),
  ('deferred', 'Отложенные', '#ea580c', 2),
  ('delivery', 'Доставка', '#0891b2', 3),
  ('ready', 'Готовые', '#334155', 4),
  ('closed_ok', 'Закрытые успешно', '#64748b', 5),
  ('closed_fail', 'Закрытые неуспешно', '#94a3b8', 6)
on conflict (code) do update
  set name = excluded.name,
      color = excluded.color,
      sort_order = excluded.sort_order;

alter table public.order_status_meta
  add column if not exists group_id uuid references public.order_status_groups (id) on delete restrict,
  add column if not exists color text not null default '',
  add column if not exists requires_warranty boolean not null default false,
  add column if not exists is_destructive boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_status_meta_color_format'
  ) then
    alter table public.order_status_meta
      add constraint order_status_meta_color_format
      check (color = '' or color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

create or replace function public.order_status_set_id()
returns uuid
language sql
stable
as $$
  select id from public.reference_sets where code = 'order_statuses' limit 1;
$$;

create or replace function public.ensure_order_status(
  item_code text,
  item_name text,
  group_code text,
  item_sort integer,
  p_initial boolean default false,
  p_terminal boolean default false,
  p_warehouse boolean default false,
  p_warranty boolean default false,
  p_destructive boolean default false
)
returns uuid
language plpgsql
as $$
#variable_conflict use_column
declare
  status_set_id uuid := public.order_status_set_id();
  group_uuid uuid;
  result_id uuid;
begin
  select id into group_uuid from public.order_status_groups where code = group_code;
  if group_uuid is null then
    raise exception 'Группа статусов не найдена: %', group_code;
  end if;

  insert into public.reference_items (set_id, code, name, sort_order, is_system, is_active)
  values (status_set_id, item_code, item_name, item_sort, false, true)
  on conflict (set_id, code) do update
    set name = excluded.name,
        sort_order = excluded.sort_order,
        is_system = false,
        is_active = true
  returning id into result_id;

  insert into public.order_status_meta (
    status_id, group_id, is_initial, is_terminal, notifies_warehouse, requires_warranty, is_destructive, color
  )
  values (
    result_id, group_uuid, p_initial, p_terminal, p_warehouse, p_warranty, p_destructive, ''
  )
  on conflict (status_id) do update
    set group_id = excluded.group_id,
        is_initial = excluded.is_initial,
        is_terminal = excluded.is_terminal,
        notifies_warehouse = excluded.notifies_warehouse,
        requires_warranty = excluded.requires_warranty,
        is_destructive = excluded.is_destructive;

  return result_id;
end;
$$;

select public.ensure_order_status('diagnostics', 'Диагностика', 'new', 0, true, false, false, false, false);
select public.ensure_order_status('requires_approval', 'Требует согласования', 'new', 1);
select public.ensure_order_status('quality_check', 'В работе', 'in_progress', 20);
select public.ensure_order_status('repair', 'В ремонт', 'in_progress', 21, false, false, true, false, false);
select public.ensure_order_status('under_warranty', 'По гарантии', 'in_progress', 22);
select public.ensure_order_status('donor', 'Донор', 'in_progress', 23);
select public.ensure_order_status('maintenance', 'ТО', 'in_progress', 24);
select public.ensure_order_status('waiting_approval', 'На согласовании', 'deferred', 40);
select public.ensure_order_status('waiting_parts', 'Ждет запчасть', 'deferred', 41);
select public.ensure_order_status('potential_writeoff', 'Потенциально на списание', 'deferred', 42);
select public.ensure_order_status('donor_substitute', 'Донор отдан на подмену', 'deferred', 43);
select public.ensure_order_status('delivery', 'Доставка', 'delivery', 60);
select public.ensure_order_status('lent_out', 'Отдан на время', 'delivery', 61);
select public.ensure_order_status('ready', 'Готов', 'ready', 80);
select public.ensure_order_status('serviceable_balance', 'Исправный балансовый прибор', 'ready', 81);
select public.ensure_order_status('paid_awaiting_shipment', 'Оплачен, ожидает отправки', 'ready', 82);
select public.ensure_order_status('issued_awaiting_payment', 'Отдан и ожидает оплаты', 'closed_ok', 100, false, true, false, false, false);
select public.ensure_order_status('issued', 'Отдан и оплачен', 'closed_ok', 101, false, true, false, true, false);
select public.ensure_order_status('issued_no_repair', 'Отдан без ремонта', 'closed_ok', 102, false, true, false, false, false);
select public.ensure_order_status('cancelled', 'Отказ', 'closed_fail', 120, false, true, false, false, true);
select public.ensure_order_status('refused_no_repair', 'Отказ отдан без ремонта', 'closed_fail', 121, false, true, false, false, true);
select public.ensure_order_status('issued_unpaid', 'Отдан без оплаты', 'closed_fail', 122, false, true, false, false, true);

update public.orders o
set status_id = d.id
from public.reference_items r
join public.reference_sets s on s.id = r.set_id and s.code = 'order_statuses'
join public.reference_items d
  on d.set_id = s.id and d.code = 'diagnostics'
where o.status_id = r.id
  and r.code = 'received';

update public.order_status_meta m
set is_initial = false
from public.reference_items r
join public.reference_sets s on s.id = r.set_id and s.code = 'order_statuses'
where m.status_id = r.id
  and r.code = 'received';

update public.reference_items r
set is_active = false, is_system = false
from public.reference_sets s
where s.id = r.set_id
  and s.code = 'order_statuses'
  and r.code = 'received';

delete from public.order_status_transitions t
using public.reference_items r
join public.reference_sets s on s.id = r.set_id and s.code = 'order_statuses'
where r.code = 'received'
  and (t.from_status_id = r.id or t.to_status_id = r.id);

create or replace function public.sync_order_status_transitions()
returns void
language plpgsql
as $$
begin
  insert into public.order_status_transitions (from_status_id, to_status_id, required_permission, sort_order)
  select src.id, dst.id, 'orders:change_status', dst.sort_order
  from public.reference_items src
  join public.reference_sets s on s.id = src.set_id and s.code = 'order_statuses'
  join public.order_status_meta sm on sm.status_id = src.id
  join public.reference_items dst on dst.set_id = src.set_id and dst.id <> src.id and dst.is_active
  where src.is_active
    and sm.is_terminal = false
  on conflict (from_status_id, to_status_id) do nothing;

  delete from public.order_status_transitions t
  using public.order_status_meta m
  where t.from_status_id = m.status_id
    and m.is_terminal = true;
end;
$$;

select public.sync_order_status_transitions();

insert into public.order_transition_rules (transition_id, rule_code)
select t.id, 'diagnostics_conclusion'
from public.order_status_transitions t
join public.reference_items f on f.id = t.from_status_id
join public.reference_items dst on dst.id = t.to_status_id
join public.reference_sets s on s.id = f.set_id and s.code = 'order_statuses'
where f.code = 'diagnostics'
  and dst.code in ('waiting_approval', 'requires_approval')
on conflict do nothing;

create or replace view public.order_status_catalog
with (security_invoker = true) as
select
  i.id,
  i.code,
  i.name,
  i.is_active,
  i.is_system,
  i.sort_order,
  g.id as group_id,
  g.code as group_code,
  g.name as group_name,
  g.sort_order as group_sort_order,
  g.color as group_color,
  coalesce(nullif(m.color, ''), g.color) as color,
  coalesce(m.is_initial, false) as is_initial,
  coalesce(m.is_terminal, false) as is_terminal,
  coalesce(m.notifies_warehouse, false) as notifies_warehouse,
  coalesce(m.requires_warranty, false) as requires_warranty,
  coalesce(m.is_destructive, false) as is_destructive
from public.reference_items i
join public.reference_sets s on s.id = i.set_id and s.code = 'order_statuses'
left join public.order_status_meta m on m.status_id = i.id
left join public.order_status_groups g on g.id = m.group_id;

create or replace function public.upsert_order_status_group(
  target_id uuid,
  group_code text,
  group_name text,
  group_color text,
  group_sort integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  normalized_name text;
  normalized_color text;
  result_id uuid;
  next_sort integer;
begin
  perform public.assert_settings_write();

  normalized_code := lower(btrim(coalesce(group_code, '')));
  normalized_name := btrim(coalesce(group_name, ''));
  normalized_color := upper(left(btrim(coalesce(group_color, '')), 1)) || substr(btrim(coalesce(group_color, '')), 2);

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код группы: латиница, цифры и подчёркивание.';
  end if;
  if char_length(normalized_name) < 1 or char_length(normalized_name) > 80 then
    raise exception 'Укажите название группы.';
  end if;
  if normalized_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Цвет группы — HEX вида #2563eb.';
  end if;

  if target_id is not null then
    update public.order_status_groups
    set code = normalized_code, name = normalized_name, color = normalized_color,
        sort_order = coalesce(group_sort, sort_order)
    where id = target_id
    returning id into result_id;
    if result_id is null then
      raise exception 'Группа не найдена.';
    end if;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort from public.order_status_groups;
    insert into public.order_status_groups (code, name, color, sort_order)
    values (normalized_code, normalized_name, normalized_color, coalesce(group_sort, next_sort))
    returning id into result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'orders.status_group_created' else 'orders.status_group_updated' end,
    'order_status_group',
    result_id::text,
    jsonb_build_object('code', normalized_code)
  );
  return result_id;
exception
  when unique_violation then
    raise exception 'Группа с таким кодом уже есть.';
end;
$$;

create or replace function public.delete_order_status_group(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.order_status_groups where id = target_id) then
    raise exception 'Группа не найдена.';
  end if;
  if exists (select 1 from public.order_status_meta where group_id = target_id) then
    raise exception 'В группе есть статусы. Сначала перенесите или удалите их.';
  end if;

  delete from public.order_status_groups where id = target_id;
  perform public.record_audit('orders.status_group_deleted', 'order_status_group', target_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.upsert_order_status(
  target_id uuid,
  item_code text,
  item_name text,
  target_group_id uuid,
  item_color text default '',
  p_initial boolean default false,
  p_terminal boolean default false,
  p_warehouse boolean default false,
  p_warranty boolean default false,
  p_destructive boolean default false,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  status_set_id uuid := public.order_status_set_id();
  result_id uuid;
  normalized_color text := btrim(coalesce(item_color, ''));
  was_new boolean := target_id is null;
begin
  perform public.assert_settings_write();

  if status_set_id is null then
    raise exception 'Справочник статусов не найден.';
  end if;
  if not exists (select 1 from public.order_status_groups where id = target_group_id) then
    raise exception 'Выберите группу статуса.';
  end if;
  if normalized_color <> '' and normalized_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Цвет статуса — HEX вида #2563eb или пусто.';
  end if;

  result_id := public.upsert_reference_item(
    target_id,
    status_set_id,
    item_code,
    item_name,
    '',
    null
  );

  update public.reference_items
  set is_active = p_active, is_system = false
  where id = result_id;

  if p_initial then
    update public.order_status_meta set is_initial = false where status_id <> result_id;
  elsif was_new = false and not exists (
    select 1 from public.order_status_meta where status_id <> result_id and is_initial
  ) then
    null;
  end if;

  if not p_initial and not exists (
    select 1 from public.order_status_meta m
    join public.reference_items i on i.id = m.status_id
    where m.is_initial and m.status_id <> result_id and i.is_active
  ) then
    raise exception 'Должен остаться хотя бы один начальный статус.';
  end if;

  insert into public.order_status_meta (
    status_id, group_id, color, is_initial, is_terminal, notifies_warehouse, requires_warranty, is_destructive
  )
  values (
    result_id, target_group_id, normalized_color, p_initial, p_terminal, p_warehouse, p_warranty, p_destructive
  )
  on conflict (status_id) do update
    set group_id = excluded.group_id,
        color = excluded.color,
        is_initial = excluded.is_initial,
        is_terminal = excluded.is_terminal,
        notifies_warehouse = excluded.notifies_warehouse,
        requires_warranty = excluded.requires_warranty,
        is_destructive = excluded.is_destructive;

  perform public.sync_order_status_transitions();

  perform public.record_audit(
    case when was_new then 'orders.status_created' else 'orders.status_updated' end,
    'order_status',
    result_id::text,
    jsonb_build_object('code', item_code, 'name', item_name)
  );

  return result_id;
end;
$$;

create or replace function public.delete_order_status(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Статус не найден.';
  end if;

  if exists (select 1 from public.orders where status_id = target_id) then
    raise exception 'Статус используется в заказах. Скройте его, чтобы не показывать в списках.';
  end if;

  if exists (select 1 from public.order_status_meta where status_id = target_id and is_initial) then
    raise exception 'Нельзя удалить начальный статус. Назначьте другой, затем удалите.';
  end if;

  delete from public.order_status_transitions
  where from_status_id = target_id or to_status_id = target_id;
  delete from public.order_status_meta where status_id = target_id;
  delete from public.reference_items where id = target_id;

  perform public.record_audit(
    'orders.status_deleted',
    'order_status',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'name', current_row.name)
  );
end;
$$;

create or replace function public.reorder_order_statuses(item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_settings_write();
  perform public.reorder_reference_items(public.order_status_set_id(), item_ids);
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
  needs_warranty boolean := false;
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

drop function if exists public.get_available_order_transitions(uuid);

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
    select
      tr.id,
      tr.to_status_id,
      tr.required_permission,
      i.code,
      i.name,
      g.code as group_code,
      g.name as group_name,
      coalesce(g.sort_order, 999) as group_sort_order,
      coalesce(nullif(m.color, ''), g.color) as color,
      coalesce(m.requires_warranty, false) as requires_warranty,
      coalesce(m.is_destructive, false) as is_destructive,
      i.sort_order
    from public.order_status_transitions tr
    join public.reference_items i on i.id = tr.to_status_id
    left join public.order_status_meta m on m.status_id = i.id
    left join public.order_status_groups g on g.id = m.group_id
    where tr.from_status_id = current_row.status_id
      and tr.is_active = true
    order by coalesce(g.sort_order, 999), i.sort_order
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

alter table public.order_status_groups enable row level security;

drop policy if exists order_status_groups_select on public.order_status_groups;
create policy order_status_groups_select
  on public.order_status_groups
  for select
  to authenticated
  using (public.is_active_user());

grant select on public.order_status_groups to authenticated;
grant select on public.order_status_catalog to authenticated;

revoke all on function public.upsert_order_status_group(uuid, text, text, text, integer) from public, anon;
revoke all on function public.delete_order_status_group(uuid) from public, anon;
revoke all on function public.upsert_order_status(uuid, text, text, uuid, text, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.delete_order_status(uuid) from public, anon;
revoke all on function public.reorder_order_statuses(uuid[]) from public, anon;
revoke all on function public.get_available_order_transitions(uuid) from public, anon;

grant execute on function public.upsert_order_status_group(uuid, text, text, text, integer) to authenticated;
grant execute on function public.delete_order_status_group(uuid) to authenticated;
grant execute on function public.upsert_order_status(uuid, text, text, uuid, text, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.delete_order_status(uuid) to authenticated;
grant execute on function public.reorder_order_statuses(uuid[]) to authenticated;
grant execute on function public.get_available_order_transitions(uuid) to authenticated;
grant execute on function public.change_order_status(uuid, uuid, date, date) to authenticated;
