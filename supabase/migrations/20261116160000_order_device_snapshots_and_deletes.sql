-- Удаление прибора (и видов группа/бренд/модель) не ломает историю заказов:
-- на заказе хранится снимок group/brand/model/label, device_id можно обнулить.

-- -----------------------------------------------------------------------------
-- Snapshot columns on orders
-- -----------------------------------------------------------------------------

alter table public.orders
  add column if not exists device_group text not null default '',
  add column if not exists device_brand text not null default '',
  add column if not exists device_model text not null default '',
  add column if not exists device_label text not null default '';

create or replace function public.device_classification_snapshot(target_device_id uuid)
returns table (
  serial_number text,
  device_group text,
  device_brand text,
  device_model text,
  device_label text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(d.serial_number, '') as serial_number,
    coalesce(grp.name, '') as device_group,
    coalesce(brand.name, '') as device_brand,
    coalesce(model.name, '') as device_model,
    public.device_display_name(grp.name, brand.name, model.name) as device_label
  from public.devices d
  left join public.reference_items grp on grp.id = d.group_id
  left join public.reference_items brand on brand.id = d.brand_id
  left join public.reference_items model on model.id = d.model_id
  where d.id = target_device_id;
$$;

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

-- Backfill existing orders from live device classification.
update public.orders o
set
  serial_number = coalesce(nullif(btrim(o.serial_number), ''), snap.serial_number, o.serial_number),
  device_group = snap.device_group,
  device_brand = snap.device_brand,
  device_model = snap.device_model,
  device_label = snap.device_label
from public.devices d
cross join lateral public.device_classification_snapshot(d.id) as snap
where o.device_id = d.id;

-- Fallback label for any leftover empty snapshots.
update public.orders
set device_label = case
  when btrim(device_label) <> '' then device_label
  when btrim(device_brand) <> '' or btrim(device_model) <> '' then
    public.device_display_name(device_group, device_brand, device_model)
  else coalesce(nullif(btrim(serial_number), ''), '')
end
where btrim(device_label) = '';

-- -----------------------------------------------------------------------------
-- device_id nullable + ON DELETE SET NULL
-- -----------------------------------------------------------------------------

alter table public.orders
  alter column device_id drop not null;

alter table public.orders
  drop constraint if exists orders_device_id_fkey;

alter table public.orders
  add constraint orders_device_id_fkey
  foreign key (device_id) references public.devices (id) on delete set null;

-- -----------------------------------------------------------------------------
-- order_list_items: LEFT JOIN devices, prefer order snapshot text
-- -----------------------------------------------------------------------------

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
  d.group_id as device_group_id,
  d.brand_id as device_brand_id,
  d.model_id as device_model_id,
  coalesce(nullif(btrim(o.device_brand), ''), brand.name, '') as device_brand,
  coalesce(nullif(btrim(o.device_model), ''), model.name, '') as device_model,
  coalesce(
    nullif(btrim(o.device_label), ''),
    public.device_display_name(grp.name, brand.name, model.name),
    ''
  ) as device_label,
  o.status_id,
  st.code as status_code,
  st.name as status_name,
  coalesce(meta.is_terminal, false) as is_terminal,
  o.responsible_id,
  coalesce(nullif(p.full_name, ''), p.email, '') as responsible_name,
  o.deadline,
  case
    when coalesce(meta.is_terminal, false) then 'closed'::text
    when o.deadline is null then 'none'::text
    when o.deadline < current_date then 'overdue'::text
    when o.deadline <= (
      current_date
      + coalesce(
        (
          select (app_settings.value ->> 'approaching_days')::integer
          from public.app_settings
          where app_settings.key = 'deadline'
        ),
        2
      )
    ) then 'approaching'::text
    else 'normal'::text
  end as deadline_state,
  o.claimed_malfunction,
  o.created_at,
  o.updated_at,
  public.order_total_amount(o.id)::numeric(14, 2) as total_amount
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.devices d on d.id = o.device_id
join public.reference_items st on st.id = o.status_id
left join public.order_status_meta meta on meta.status_id = o.status_id
left join public.profiles p on p.id = o.responsible_id
left join public.reference_items grp on grp.id = d.group_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id;

grant select on public.order_list_items to authenticated;

-- -----------------------------------------------------------------------------
-- create_order / update_order: write snapshots
-- -----------------------------------------------------------------------------

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

-- Keep snapshots fresh when device classification changes while still linked.
create or replace function public.refresh_order_snapshots_for_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Позволяет delete_reference_item сначала зафиксировать снимок, потом обнулить FK.
  if current_setting('app.skip_order_snapshot_refresh', true) = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.group_id is not distinct from new.group_id
     and old.brand_id is not distinct from new.brand_id
     and old.model_id is not distinct from new.model_id
     and old.modification_id is not distinct from new.modification_id
     and old.serial_number is not distinct from new.serial_number then
    return new;
  end if;

  update public.orders o
  set serial_number = snap.serial_number,
      device_group = snap.device_group,
      device_brand = snap.device_brand,
      device_model = snap.device_model,
      device_label = snap.device_label
  from public.device_classification_snapshot(new.id) as snap
  where o.device_id = new.id;

  return new;
end;
$$;

drop trigger if exists devices_refresh_order_snapshots on public.devices;
create trigger devices_refresh_order_snapshots
  after update of group_id, brand_id, model_id, modification_id, serial_number
  on public.devices
  for each row
  execute procedure public.refresh_order_snapshots_for_device();

-- -----------------------------------------------------------------------------
-- delete_device: always allowed; orders keep snapshot, lose device_id
-- -----------------------------------------------------------------------------

create or replace function public.delete_device(target_device_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.devices%rowtype;
  linked_orders integer := 0;
begin
  if not public.has_permission('devices:delete') then
    raise exception 'Недостаточно прав для удаления прибора.';
  end if;

  select * into current_row
  from public.devices
  where id = target_device_id
  for update;

  if current_row.id is null then
    raise exception 'Прибор не найден.';
  end if;

  -- Зафиксировать актуальный снимок перед отвязкой.
  update public.orders o
  set serial_number = snap.serial_number,
      device_group = snap.device_group,
      device_brand = snap.device_brand,
      device_model = snap.device_model,
      device_label = snap.device_label,
      device_id = null
  from public.device_classification_snapshot(target_device_id) as snap
  where o.device_id = target_device_id;

  get diagnostics linked_orders = row_count;

  delete from public.dynamic_field_values
  where entity_code = 'devices' and record_id = target_device_id;

  delete from public.devices
  where id = target_device_id;

  perform public.record_audit(
    'devices.deleted',
    'device',
    target_device_id::text,
    jsonb_build_object(
      'serial_number', current_row.serial_number,
      'detached_orders', linked_orders
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- delete_reference_item (виды): отвязать приборы; заказы сохраняют снимок
-- -----------------------------------------------------------------------------

create or replace function public.delete_reference_item(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
  leaf_row public.reference_items%rowtype;
  set_code text;
  subtree_ids uuid[];
  blocking integer;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Запись справочника не найдена.';
  end if;

  select s.code into set_code
  from public.reference_sets s
  where s.id = current_row.set_id;

  with recursive tree as (
    select id, 0 as depth
    from public.reference_items
    where id = target_id
    union all
    select child.id, tree.depth + 1
    from public.reference_items child
    join tree on child.parent_id = tree.id
  )
  select coalesce(array_agg(id), array[]::uuid[]) into subtree_ids
  from tree;

  if set_code in ('device_groups', 'device_brands', 'device_models', 'device_modifications') then
    update public.orders o
    set serial_number = snap.serial_number,
        device_group = snap.device_group,
        device_brand = snap.device_brand,
        device_model = snap.device_model,
        device_label = snap.device_label
    from public.devices d
    cross join lateral public.device_classification_snapshot(d.id) as snap
    where o.device_id = d.id
      and (
        d.group_id = any (subtree_ids)
        or d.brand_id = any (subtree_ids)
        or d.model_id = any (subtree_ids)
        or d.modification_id = any (subtree_ids)
      );

    perform set_config('app.skip_order_snapshot_refresh', 'on', true);

    update public.devices
    set group_id = case when group_id = any (subtree_ids) then null else group_id end,
        brand_id = case when brand_id = any (subtree_ids) then null else brand_id end,
        model_id = case when model_id = any (subtree_ids) then null else model_id end,
        modification_id = case when modification_id = any (subtree_ids) then null else modification_id end
    where group_id = any (subtree_ids)
       or brand_id = any (subtree_ids)
       or model_id = any (subtree_ids)
       or modification_id = any (subtree_ids);

    perform set_config('app.skip_order_snapshot_refresh', 'off', true);

    select (
      (
        select count(*) from public.orders where status_id = any (subtree_ids)
      ) + (
        select count(*) from public.inventory_items
        where category_id = any (subtree_ids) or unit_id = any (subtree_ids)
      ) + (
        select count(*) from public.order_status_transitions
        where from_status_id = any (subtree_ids) or to_status_id = any (subtree_ids)
      )
    )::integer
    into blocking;

    if blocking > 0 then
      raise exception 'Запись используется и не может быть удалена. Скройте её, чтобы не показывать в списках.';
    end if;
  else
    select coalesce(sum(public.reference_item_external_usage_count(id)), 0)::integer
    into blocking
    from unnest(subtree_ids) as id;

    if blocking > 0 then
      raise exception 'Запись используется и не может быть удалена. Скройте её, чтобы не показывать в списках.';
    end if;
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'devices'
    and record_id = any (subtree_ids);

  for leaf_row in
    with recursive tree as (
      select id, 0 as depth
      from public.reference_items
      where id = target_id
      union all
      select child.id, tree.depth + 1
      from public.reference_items child
      join tree on child.parent_id = tree.id
    )
    select ri.*
    from tree
    join public.reference_items ri on ri.id = tree.id
    order by tree.depth desc, ri.id
  loop
    delete from public.reference_items where id = leaf_row.id;
  end loop;

  perform public.record_audit(
    'references.item_deleted',
    'reference_item',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'set_id', current_row.set_id, 'name', current_row.name)
  );
end;
$$;

-- Usage count for device taxonomy UI: devices no longer block.
create or replace function public.reference_item_external_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    (select count(*) from public.orders where status_id = target_item_id) +
    (
      select count(*)
      from public.inventory_items
      where category_id = target_item_id or unit_id = target_item_id
    ) +
    (
      select count(*)
      from public.order_status_transitions
      where from_status_id = target_item_id or to_status_id = target_item_id
    ) +
    case
      when exists (
        select 1
        from public.reference_items i
        join public.reference_sets s on s.id = i.set_id
        where i.id = target_item_id
          and s.code in ('device_groups', 'device_brands', 'device_models', 'device_modifications')
      ) then 0
      else (
        select count(*)
        from public.devices
        where group_id = target_item_id
           or brand_id = target_item_id
           or model_id = target_item_id
           or modification_id = target_item_id
      )
    end
  )::integer;
$$;

revoke all on function public.device_classification_snapshot(uuid) from public, anon;
revoke all on function public.apply_order_device_snapshot(uuid, uuid) from public, anon;
grant execute on function public.device_classification_snapshot(uuid) to authenticated;
grant execute on function public.apply_order_device_snapshot(uuid, uuid) to authenticated;

revoke all on function public.create_order(uuid, uuid, text, text, text, date, uuid, date) from public, anon;
revoke all on function public.update_order(uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean) from public, anon;
revoke all on function public.delete_device(uuid) from public, anon;
revoke all on function public.delete_reference_item(uuid) from public, anon;
revoke all on function public.reference_item_external_usage_count(uuid) from public, anon;

grant execute on function public.create_order(uuid, uuid, text, text, text, date, uuid, date) to authenticated;
grant execute on function public.update_order(uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean) to authenticated;
grant execute on function public.delete_device(uuid) to authenticated;
grant execute on function public.delete_reference_item(uuid) to authenticated;
grant execute on function public.reference_item_external_usage_count(uuid) to authenticated;

notify pgrst, 'reload schema';
