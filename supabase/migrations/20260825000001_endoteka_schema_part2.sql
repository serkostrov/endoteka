-- =============================================================================
-- Эндотека: schema squash — часть 2/3
-- Секции исходных миграций: [19/151] … [91/151]
-- Файлы: 20260826800000_performance.sql … 20260829690000_inventory_write_offs.sql
-- Размер части: ~422 KiB
--
-- Применять строго по порядку: part1 → part2 → part3
-- на чистой БД (SQL Editor / psql -v ON_ERROR_STOP=1).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- [1/73 | was 19/151] 20260826800000_performance.sql
-- -----------------------------------------------------------------------------

-- Производительность: остаток по кэшу партий и один проход по открытым заказам на рабочем столе.
-- Остаток в списке склада совпадает с FIFO: remaining_quantity обновляет только триггер журнала движений.

create or replace function public.search_inventory_items(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  stock_filter text default 'all'
)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  safe_page integer;
  safe_size integer;
  stock_value text;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('orders:read')
    or public.has_permission('sales:read')
    or public.has_permission('sales:create')
  ) then
    raise exception 'Недостаточно прав для просмотра склада.';
  end if;

  stock_value := coalesce(nullif(btrim(stock_filter), ''), 'all');
  if stock_value not in ('all', 'zero') then
    raise exception 'Неизвестный фильтр остатка.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  with stock as (
    select b.item_id, coalesce(sum(b.remaining_quantity), 0) as qty
    from public.inventory_batches b
    group by b.item_id
  )
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '') as category_name,
    i.unit_id,
    coalesce(u.name, '') as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    coalesce(stock.qty, 0) as stock_quantity,
    i.created_at,
    i.updated_at,
    count(*) over() as total_count
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where (
      btrim(coalesce(search_query, '')) = ''
      or i.name ilike term escape '\'
      or i.code ilike term escape '\'
      or i.article ilike term escape '\'
      or i.barcode ilike term escape '\'
    )
    and (stock_value <> 'zero' or coalesce(stock.qty, 0) <= 0)
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_operational_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  can_orders boolean := public.has_permission('orders:read');
  can_tasks boolean := public.has_permission('tasks:read');
  can_inventory boolean := public.has_permission('inventory:read');
  can_notifications boolean := public.has_permission('notifications:read');
  approaching_days integer;
  order_payload jsonb;
  task_payload jsonb;
  result jsonb;
begin
  if not public.has_permission('dashboard:read') then
    raise exception 'Недостаточно прав.';
  end if;

  select coalesce((value ->> 'approaching_days')::integer, 2)
    into approaching_days
  from public.app_settings
  where key = 'deadline';
  approaching_days := coalesce(approaching_days, 2);

  result := jsonb_build_object(
    'can_orders', can_orders,
    'can_tasks', can_tasks,
    'can_inventory', can_inventory,
    'can_notifications', can_notifications,
    'can_diagnostics', public.has_permission('diagnostics:read')
  );

  if can_orders then
    with open_orders as (
      select
        o.id,
        o.number,
        c.name as customer_name,
        st.code as status_code,
        st.name as status_name,
        o.deadline,
        o.updated_at,
        o.responsible_id,
        coalesce(nullif(p.full_name, ''), p.email, '') as responsible_name,
        case
          when o.deadline is null then 'none'
          when o.deadline < current_date then 'overdue'
          when o.deadline <= current_date + approaching_days then 'approaching'
          else 'normal'
        end as deadline_state
      from public.orders o
      join public.customers c on c.id = o.customer_id
      join public.reference_items st on st.id = o.status_id
      left join public.order_status_meta meta on meta.status_id = o.status_id
      left join public.profiles p on p.id = o.responsible_id
      where not coalesce(meta.is_terminal, false)
    ),
    stats as (
      select
        count(*) as active,
        count(*) filter (
          where deadline_state in ('overdue', 'approaching') or status_code = 'waiting_approval'
        ) as attention,
        count(*) filter (where deadline_state = 'overdue') as overdue,
        count(*) filter (where deadline_state = 'approaching') as approaching,
        count(*) filter (where status_code = 'waiting_approval') as waiting_approval,
        count(*) filter (where status_code = 'repair') as repair,
        count(*) filter (where status_code = 'diagnostics') as diagnostics,
        count(*) filter (where responsible_id = auth.uid()) as mine_active,
        count(*) filter (where responsible_id = auth.uid() and deadline_state = 'overdue') as mine_overdue,
        count(*) filter (where responsible_id = auth.uid() and status_code = 'diagnostics') as mine_diagnostics
      from open_orders
    )
    select jsonb_build_object(
      'active', stats.active,
      'attention', stats.attention,
      'overdue', stats.overdue,
      'approaching', stats.approaching,
      'waiting_approval', stats.waiting_approval,
      'repair', stats.repair,
      'diagnostics', stats.diagnostics,
      'mine_active', stats.mine_active,
      'mine_overdue', stats.mine_overdue,
      'mine_diagnostics', stats.mine_diagnostics,
      'overdue_items', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'number', o.number,
              'customer_name', o.customer_name,
              'status_code', o.status_code,
              'status_name', o.status_name,
              'deadline', o.deadline,
              'deadline_state', o.deadline_state,
              'responsible_name', o.responsible_name
            )
            order by o.deadline, o.number
          ),
          '[]'::jsonb
        )
        from (
          select id, number, customer_name, status_code, status_name, deadline, deadline_state, responsible_name
          from open_orders
          where deadline_state = 'overdue'
          order by deadline, number
          limit 5
        ) o
      ),
      'mine_items', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'number', o.number,
              'customer_name', o.customer_name,
              'status_code', o.status_code,
              'status_name', o.status_name,
              'deadline', o.deadline,
              'deadline_state', o.deadline_state,
              'responsible_name', o.responsible_name
            )
            order by o.priority, o.deadline nulls last, o.number
          ),
          '[]'::jsonb
        )
        from (
          select
            id,
            number,
            customer_name,
            status_code,
            status_name,
            deadline,
            deadline_state,
            responsible_name,
            case deadline_state when 'overdue' then 0 when 'approaching' then 1 else 2 end as priority
          from open_orders
          where responsible_id = auth.uid()
          order by
            case deadline_state when 'overdue' then 0 when 'approaching' then 1 else 2 end,
            deadline nulls last,
            number
          limit 5
        ) o
      ),
      'repair_items', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'number', o.number,
              'customer_name', o.customer_name,
              'status_code', o.status_code,
              'status_name', o.status_name,
              'deadline', o.deadline,
              'deadline_state', o.deadline_state,
              'responsible_name', o.responsible_name
            )
            order by o.updated_at desc
          ),
          '[]'::jsonb
        )
        from (
          select id, number, customer_name, status_code, status_name, deadline, deadline_state, responsible_name, updated_at
          from open_orders
          where status_code = 'repair'
          order by updated_at desc
          limit 5
        ) o
      )
    )
    into order_payload
    from stats;

    result := result || jsonb_build_object('orders', order_payload);
  end if;

  if can_tasks then
    with task_stats as (
      select
        count(*) filter (where not completed) as open,
        count(*) filter (where not completed and assignee_id = auth.uid()) as mine_open,
        count(*) filter (
          where not completed and assignee_id = auth.uid() and due_date = current_date
        ) as mine_today,
        count(*) filter (
          where not completed
            and assignee_id = auth.uid()
            and due_date is not null
            and due_date < current_date
        ) as mine_overdue
      from public.tasks
    )
    select jsonb_build_object(
      'open', task_stats.open,
      'mine_open', task_stats.mine_open,
      'mine_today', task_stats.mine_today,
      'mine_overdue', task_stats.mine_overdue,
      'mine_items', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', t.id,
              'title', t.title,
              'due_date', t.due_date,
              'priority', t.priority,
              'order_number', coalesce(o.number, '')
            )
            order by t.sort_key, t.due_date nulls last, t.created_at
          ),
          '[]'::jsonb
        )
        from (
          select
            tasks.id,
            tasks.title,
            tasks.due_date,
            tasks.priority,
            tasks.order_id,
            tasks.created_at,
            case
              when tasks.due_date is not null and tasks.due_date < current_date then 0
              when tasks.due_date = current_date then 1
              else 2
            end as sort_key
          from public.tasks
          where not completed and assignee_id = auth.uid()
          order by
            case
              when due_date is not null and due_date < current_date then 0
              when due_date = current_date then 1
              else 2
            end,
            due_date nulls last,
            created_at
          limit 5
        ) t
        left join public.orders o on o.id = t.order_id
      )
    )
    into task_payload
    from task_stats;

    result := result || jsonb_build_object('tasks', task_payload);
  end if;

  if can_notifications then
    result := result || jsonb_build_object(
      'notifications', jsonb_build_object(
        'unread', (
          select count(*) from public.notification_recipients nr
          where nr.recipient_id = auth.uid() and not nr.is_read
        ),
        'items', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', n.id,
                'title', n.title,
                'body', n.body,
                'entity_type', n.entity_type,
                'entity_id', n.entity_id,
                'created_at', n.created_at
              )
              order by n.created_at desc
            ),
            '[]'::jsonb
          )
          from (
            select n.id, n.title, n.body, n.entity_type, n.entity_id, n.created_at
            from public.notification_recipients nr
            join public.notifications n on n.id = nr.notification_id
            where nr.recipient_id = auth.uid() and not nr.is_read
            order by n.created_at desc
            limit 5
          ) n
        )
      )
    );
  end if;

  if can_inventory then
    result := result || jsonb_build_object(
      'inventory', jsonb_build_object(
        'zero_stock', (
          select count(*)
          from public.inventory_items i
          where not exists (
            select 1
            from public.inventory_batches b
            where b.item_id = i.id and b.remaining_quantity > 0
          )
        ),
        'items', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', s.id,
                'name', s.name,
                'code', s.code,
                'stock_quantity', s.qty
              )
              order by s.name
            ),
            '[]'::jsonb
          )
          from (
            select i.id, i.name, i.code, 0::numeric as qty
            from public.inventory_items i
            where not exists (
              select 1
              from public.inventory_batches b
              where b.item_id = i.id and b.remaining_quantity > 0
            )
            order by i.name
            limit 5
          ) s
        )
      )
    );
  end if;

  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- [2/73 | was 20/151] 20260826900000_acceptance_fixes.sql
-- -----------------------------------------------------------------------------

-- Приёмка: журнал заказа, этикетка штрихкода, ручная проверка сроков, закрытие устаревшего RPC продажи.

grant execute on function public.process_order_deadline_notifications() to authenticated;

revoke all on function public.consume_inventory_for_sale(uuid, numeric, text, text)
  from public, anon, authenticated;

update public.document_templates
set body = $json$
  [
    {"id":"p1","type":"text","text":"{{item.name}}"},
    {"id":"p2","type":"text","text":"{{item.code}}"},
    {"id":"bc1","type":"barcode","value":"{{item.barcode}}"},
    {"id":"p3","type":"text","text":"{{item.article}}"}
  ]
$json$::jsonb
where code = 'label_part' and is_system = true;

create or replace function public.write_order_journal_on_parts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.reference_type <> 'order' or new.movement_type <> 'repair_consumption' then
    return new;
  end if;

  select name into item_name from public.inventory_items where id = new.item_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    new.reference_id,
    'parts_consumed',
    auth.uid(),
    'Списано: ' || coalesce(item_name, 'позиция') || ' × ' || trim(to_char(abs(new.quantity), '999999990.999')),
    jsonb_build_object(
      'item_id', new.item_id,
      'quantity', abs(new.quantity),
      'movement_id', new.id
    )
  );

  return new;
end;
$$;

drop trigger if exists inventory_movements_order_journal on public.inventory_movements;
create trigger inventory_movements_order_journal
  after insert on public.inventory_movements
  for each row
  execute procedure public.write_order_journal_on_parts();

create or replace function public.write_order_journal_on_responsible()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  responsible_name text;
begin
  if new.responsible_id is not distinct from old.responsible_id then
    return new;
  end if;

  if new.responsible_id is not null then
    select coalesce(nullif(full_name, ''), email, '')
      into responsible_name
    from public.profiles
    where id = new.responsible_id;
  end if;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    new.id,
    'responsible_assigned',
    auth.uid(),
    case
      when new.responsible_id is null then 'Ответственный снят'
      else 'Назначен ответственный: ' || coalesce(nullif(responsible_name, ''), 'сотрудник')
    end,
    jsonb_build_object(
      'responsible_id', new.responsible_id,
      'previous_responsible_id', old.responsible_id
    )
  );

  return new;
end;
$$;

drop trigger if exists orders_responsible_journal on public.orders;
create trigger orders_responsible_journal
  after update of responsible_id on public.orders
  for each row
  execute procedure public.write_order_journal_on_responsible();

-- -----------------------------------------------------------------------------
-- [3/73 | was 21/151] 20260827000000_delete_settings_records.sql
-- -----------------------------------------------------------------------------

-- Удаление записей справочников, доп. полей и переходов статусов.

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
    (select count(*) from public.devices where group_id = target_item_id or brand_id = target_item_id or model_id = target_item_id or modification_id = target_item_id) +
    (select count(*) from public.inventory_items where category_id = target_item_id or unit_id = target_item_id) +
    (select count(*) from public.order_status_transitions where from_status_id = target_item_id or to_status_id = target_item_id)
  )::integer;
$$;

create or replace function public.delete_reference_item(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
  usage_count integer;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Запись справочника не найдена.';
  end if;

  if current_row.is_system then
    raise exception 'Системную запись удалить нельзя.';
  end if;

  usage_count := public.reference_item_usage_count(target_id);
  if usage_count > 0 then
    raise exception 'Запись используется и не может быть удалена. Скройте её, чтобы не показывать в списках.';
  end if;

  delete from public.reference_items where id = target_id;

  perform public.record_audit(
    'references.item_deleted',
    'reference_item',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'set_id', current_row.set_id, 'name', current_row.name)
  );
end;
$$;

create or replace function public.delete_dynamic_field(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.dynamic_fields%rowtype;
begin
  perform public.assert_settings_write();

  select * into current_row from public.dynamic_fields where id = target_id;
  if current_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  delete from public.dynamic_field_values where field_id = target_id;
  delete from public.dynamic_fields where id = target_id;

  perform public.record_audit(
    'fields.deleted',
    'dynamic_field',
    target_id::text,
    jsonb_build_object('entity_code', current_row.entity_code, 'code', current_row.code, 'name', current_row.name)
  );
end;
$$;

create or replace function public.delete_order_transition(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_status_transitions%rowtype;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения маршрута.';
  end if;

  select * into current_row from public.order_status_transitions where id = target_id;
  if current_row.id is null then
    raise exception 'Переход не найден.';
  end if;

  delete from public.order_status_transitions where id = target_id;

  perform public.record_audit(
    'orders.transition_deleted',
    'order_transition',
    target_id::text,
    jsonb_build_object('from_status_id', current_row.from_status_id, 'to_status_id', current_row.to_status_id)
  );
end;
$$;

revoke all on function public.delete_reference_item(uuid) from public;
revoke all on function public.delete_dynamic_field(uuid) from public;
revoke all on function public.delete_order_transition(uuid) from public;

grant execute on function public.delete_reference_item(uuid) to authenticated;
grant execute on function public.delete_dynamic_field(uuid) to authenticated;
grant execute on function public.delete_order_transition(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [4/73 | was 22/151] 20260827100000_update_delete_users.sql
-- -----------------------------------------------------------------------------

-- Редактирование учётной записи (кроме email) и подготовка к удалению через Edge Function.

alter table public.invitations
  alter column invited_by drop not null;

alter table public.invitations
  drop constraint if exists invitations_invited_by_fkey;

alter table public.invitations
  add constraint invitations_invited_by_fkey
    foreign key (invited_by) references public.profiles (id) on delete set null;

alter table public.user_roles
  drop constraint if exists user_roles_assigned_by_fkey;

alter table public.user_roles
  add constraint user_roles_assigned_by_fkey
    foreign key (assigned_by) references public.profiles (id) on delete set null;

create or replace function public.update_user_account(
  target_user_id uuid,
  next_full_name text,
  target_role_id uuid,
  next_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_name text;
  current_active boolean;
  previous_role_id uuid;
begin
  if not public.has_permission('users:update') then
    raise exception 'Недостаточно прав для изменения пользователя.';
  end if;

  select p.full_name, p.is_active
    into current_name, current_active
  from public.profiles p
  where p.id = target_user_id;

  if not found then
    raise exception 'Пользователь не найден.';
  end if;

  next_full_name := btrim(coalesce(next_full_name, ''));
  if next_full_name = '' then
    raise exception 'Укажите имя.';
  end if;

  if next_full_name <> current_name then
    update public.profiles
    set full_name = next_full_name
    where id = target_user_id;

    perform public.record_audit(
      'users.updated',
      'user',
      target_user_id::text,
      jsonb_build_object('full_name', next_full_name)
    );
  end if;

  select ur.role_id
    into previous_role_id
  from public.user_roles ur
  where ur.user_id = target_user_id;

  if previous_role_id is distinct from target_role_id then
    perform public.assign_user_role(target_user_id, target_role_id);
  end if;

  if target_user_id = auth.uid() then
    if next_active is distinct from current_active then
      raise exception 'Нельзя изменить статус собственной учётной записи.';
    end if;
  else
    perform public.set_user_active(target_user_id, next_active);
  end if;
end;
$$;

create or replace function public.prepare_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_name text;
  current_email text;
  current_active boolean;
  current_role text;
begin
  if not public.has_permission('users:update') then
    raise exception 'Недостаточно прав для удаления пользователя.';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Нельзя удалить собственную учётную запись.';
  end if;

  select p.full_name, p.email, p.is_active, r.code
    into current_name, current_email, current_active, current_role
  from public.profiles p
  left join public.user_roles ur on ur.user_id = p.id
  left join public.roles r on r.id = ur.role_id
  where p.id = target_user_id;

  if not found then
    raise exception 'Пользователь не найден.';
  end if;

  if current_role = 'director' and public.director_count(target_user_id) = 0 then
    raise exception 'Нельзя удалить последнего руководителя.';
  end if;

  perform public.record_audit(
    'users.deleted',
    'user',
    target_user_id::text,
    jsonb_build_object(
      'email', current_email,
      'full_name', current_name,
      'role_code', current_role,
      'is_active', current_active
    )
  );
end;
$$;

revoke all on function public.update_user_account(uuid, text, uuid, boolean) from public;
revoke all on function public.prepare_delete_user(uuid) from public;

grant execute on function public.update_user_account(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.prepare_delete_user(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [5/73 | was 23/151] 20260827200000_user_password.sql
-- -----------------------------------------------------------------------------

-- Смена пароля сотрудника: аудит без сохранения самого пароля.

create or replace function public.record_user_password_changed(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('users:update') then
    raise exception 'Недостаточно прав для изменения пароля.';
  end if;

  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'Пользователь не найден.';
  end if;

  perform public.record_audit(
    'users.password_changed',
    'user',
    target_user_id::text,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.record_user_password_changed(uuid) from public;
grant execute on function public.record_user_password_changed(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [6/73 | was 24/151] 20260827300000_allow_delete_system_reference_items.sql
-- -----------------------------------------------------------------------------

-- Системные записи справочника можно удалять, если они нигде не используются.

create or replace function public.delete_reference_item(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
  usage_count integer;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Запись справочника не найдена.';
  end if;

  usage_count := public.reference_item_usage_count(target_id);
  if usage_count > 0 then
    raise exception 'Запись используется и не может быть удалена. Скройте её, чтобы не показывать в списках.';
  end if;

  delete from public.reference_items where id = target_id;

  perform public.record_audit(
    'references.item_deleted',
    'reference_item',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'set_id', current_row.set_id, 'name', current_row.name)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- [7/73 | was 25/151] 20260827400000_allow_delete_system_templates.sql
-- -----------------------------------------------------------------------------

-- Системные шаблоны можно удалять и менять тип, как обычные.

create or replace function public.update_document_template(
  target_template_id uuid,
  template_name text,
  template_kind text,
  template_page_size text,
  template_body jsonb
)
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

  if btrim(coalesce(template_name, '')) = '' then
    raise exception 'Укажите название шаблона.';
  end if;

  if jsonb_typeof(coalesce(template_body, '[]'::jsonb)) <> 'array' then
    raise exception 'Тело шаблона должно быть списком блоков.';
  end if;

  if template_kind is null or template_kind not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
    raise exception 'Неизвестный тип шаблона.';
  end if;

  if template_page_size is null or template_page_size not in ('a4', 'label') then
    raise exception 'Неизвестный формат страницы.';
  end if;

  update public.document_templates
  set name = btrim(template_name),
      kind = template_kind,
      page_size = template_page_size,
      body = coalesce(template_body, body)
  where id = target_template_id;

  perform public.record_audit(
    'document.template_updated',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', btrim(template_name))
  );
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

  if exists (select 1 from public.documents where template_id = target_template_id) then
    raise exception 'Шаблон уже использован в документах.';
  end if;

  delete from public.document_templates
  where id = target_template_id;

  perform public.record_audit(
    'document.template_deleted',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', current_row.name)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- [8/73 | was 26/151] 20260827500000_delete_device.sql
-- -----------------------------------------------------------------------------

-- Удаление прибора, если по нему ещё нет заказов.

create or replace function public.delete_device(target_device_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.devices%rowtype;
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

  if exists (select 1 from public.orders where device_id = target_device_id) then
    raise exception 'Прибор нельзя удалить: по нему есть заказы.';
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'devices' and record_id = target_device_id;

  delete from public.devices
  where id = target_device_id;

  perform public.record_audit(
    'devices.deleted',
    'device',
    target_device_id::text,
    jsonb_build_object('serial_number', current_row.serial_number)
  );
end;
$$;

revoke all on function public.delete_device(uuid) from public;
grant execute on function public.delete_device(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [9/73 | was 27/151] 20260827600000_delete_inventory_item.sql
-- -----------------------------------------------------------------------------

-- Удаление позиции склада, если по ней нет партий, движений и документов.

create or replace function public.delete_inventory_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_items%rowtype;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления номенклатуры.';
  end if;

  select * into current_row
  from public.inventory_items
  where id = target_item_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция не найдена.';
  end if;

  if exists (select 1 from public.inventory_batches where item_id = target_item_id)
    or exists (select 1 from public.inventory_movements where item_id = target_item_id)
    or exists (select 1 from public.sale_lines where item_id = target_item_id)
    or exists (select 1 from public.inventory_count_lines where item_id = target_item_id)
    or exists (select 1 from public.documents where source_type = 'item' and source_id = target_item_id)
  then
    raise exception 'Позицию нельзя удалить: по ней есть партии, движения или документы.';
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'inventory' and record_id = target_item_id;

  delete from public.inventory_items
  where id = target_item_id;

  perform public.record_audit(
    'inventory.item_deleted',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', current_row.name, 'code', current_row.code)
  );
end;
$$;

revoke all on function public.delete_inventory_item(uuid) from public;
grant execute on function public.delete_inventory_item(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [10/73 | was 28/151] 20260827700000_delete_customer.sql
-- -----------------------------------------------------------------------------

-- Удаление клиента, если по нему нет заказов и продаж.

create or replace function public.delete_customer(target_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.customers%rowtype;
begin
  if not public.has_permission('customers:delete') then
    raise exception 'Недостаточно прав для удаления клиента.';
  end if;

  select * into current_row
  from public.customers
  where id = target_customer_id
  for update;

  if current_row.id is null then
    raise exception 'Клиент не найден.';
  end if;

  if exists (select 1 from public.orders where customer_id = target_customer_id) then
    raise exception 'Клиента нельзя удалить: по нему есть заказы.';
  end if;

  if exists (select 1 from public.sales where customer_id = target_customer_id) then
    raise exception 'Клиента нельзя удалить: по нему есть продажи.';
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'customers' and record_id = target_customer_id;

  delete from public.customers
  where id = target_customer_id;

  perform public.record_audit(
    'customers.deleted',
    'customer',
    target_customer_id::text,
    jsonb_build_object('name', current_row.name)
  );
end;
$$;

revoke all on function public.delete_customer(uuid) from public;
grant execute on function public.delete_customer(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [11/73 | was 29/151] 20260827800000_delete_sale.sql
-- -----------------------------------------------------------------------------

-- Удаление черновика или отменённого счёта. Подтверждённую продажу нельзя удалить.

create or replace function public.delete_sale(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
begin
  if not public.has_permission('sales:delete') then
    raise exception 'Недостаточно прав для удаления продажи.';
  end if;

  current_row := public.lock_sale(target_sale_id);

  if current_row.status = 'confirmed' then
    raise exception 'Подтверждённую продажу нельзя удалить.';
  end if;

  delete from public.sale_allocations
  where sale_id = target_sale_id;

  delete from public.sale_lines
  where sale_id = target_sale_id;

  delete from public.documents
  where source_type = 'sale' and source_id = target_sale_id;

  delete from public.sales
  where id = target_sale_id;

  perform public.record_audit(
    'sale.deleted',
    'sale',
    target_sale_id::text,
    jsonb_build_object('invoice_number', current_row.invoice_number, 'status', current_row.status)
  );
end;
$$;

revoke all on function public.delete_sale(uuid) from public;
grant execute on function public.delete_sale(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [12/73 | was 30/151] 20260827900000_task_list_cards.sql
-- -----------------------------------------------------------------------------

drop function if exists public.list_tasks(text, text, text, text, text, text, uuid, integer, integer);

create function public.list_tasks(
  search_query text default '',
  assignee_filter text default 'all',
  status_filter text default 'open',
  priority_filter text default 'all',
  due_filter text default 'all',
  linked_filter text default 'all',
  order_id_filter uuid default null,
  page_number integer default 1,
  page_size integer default 30
)
returns table (
  id uuid,
  title text,
  body text,
  assignee_id uuid,
  assignee_name text,
  due_date date,
  priority text,
  completed boolean,
  order_id uuid,
  order_number text,
  customer_name text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  completed_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  assignee_value text;
  status_value text;
  priority_value text;
  due_value text;
  linked_value text;
  assignee_uuid uuid;
  safe_page integer;
  safe_size integer;
begin
  perform public.assert_tasks_read();

  assignee_value := coalesce(nullif(btrim(assignee_filter), ''), 'all');
  status_value := coalesce(nullif(btrim(status_filter), ''), 'open');
  priority_value := coalesce(nullif(btrim(priority_filter), ''), 'all');
  due_value := coalesce(nullif(btrim(due_filter), ''), 'all');
  linked_value := coalesce(nullif(btrim(linked_filter), ''), 'all');

  if status_value not in ('open', 'completed', 'all') then
    raise exception 'Неизвестный статус.';
  end if;
  if priority_value not in ('all', 'low', 'normal', 'high') then
    raise exception 'Неизвестный приоритет.';
  end if;
  if due_value not in ('all', 'overdue', 'today', 'upcoming', 'none') then
    raise exception 'Неизвестный фильтр срока.';
  end if;
  if linked_value not in ('all', 'with', 'none') then
    raise exception 'Неизвестный фильтр заказа.';
  end if;

  if assignee_value not in ('all', 'unassigned') then
    begin
      assignee_uuid := assignee_value::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Некорректный исполнитель.';
    end;
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 30), 1), 100);

  return query
  select
    t.id,
    t.title,
    left(coalesce(t.body, ''), 280) as body,
    t.assignee_id,
    coalesce(a.full_name, a.email, '') as assignee_name,
    t.due_date,
    t.priority,
    t.completed,
    t.order_id,
    coalesce(o.number, '') as order_number,
    coalesce(cu.name, '') as customer_name,
    t.created_by,
    coalesce(c.full_name, c.email, '') as created_by_name,
    t.created_at,
    t.completed_at,
    count(*) over() as total_count
  from public.tasks t
  left join public.profiles a on a.id = t.assignee_id
  left join public.profiles c on c.id = t.created_by
  left join public.orders o on o.id = t.order_id
  left join public.customers cu on cu.id = o.customer_id
  where (status_value = 'all' or (status_value = 'open' and not t.completed) or (status_value = 'completed' and t.completed))
    and (priority_value = 'all' or t.priority = priority_value)
    and (
      assignee_value = 'all'
      or (assignee_value = 'unassigned' and t.assignee_id is null)
      or t.assignee_id = assignee_uuid
    )
    and (
      due_value = 'all'
      or (due_value = 'overdue' and t.due_date is not null and t.due_date < current_date)
      or (due_value = 'today' and t.due_date = current_date)
      or (due_value = 'upcoming' and t.due_date is not null and t.due_date > current_date)
      or (due_value = 'none' and t.due_date is null)
    )
    and (
      order_id_filter is not null
      or linked_value = 'all'
      or (linked_value = 'with' and t.order_id is not null)
      or (linked_value = 'none' and t.order_id is null)
    )
    and (order_id_filter is null or t.order_id = order_id_filter)
    and (
      btrim(coalesce(search_query, '')) = ''
      or t.title ilike term escape '\'
      or t.body ilike term escape '\'
      or o.number ilike term escape '\'
    )
  order by t.completed asc, t.due_date asc nulls last, t.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

comment on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) is
  'Список задач для карточек: описание, клиент заказа, сортировка по сроку.';

revoke all on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) from public;
grant execute on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- [13/73 | was 31/151] 20260828000000_delete_task.sql
-- -----------------------------------------------------------------------------

-- Удаление задачи. Если задача связана с заказом, в журнал заказа пишется событие.

create or replace function public.assert_tasks_delete()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('tasks:delete') then
    raise exception 'Недостаточно прав для удаления задачи.';
  end if;
end;
$$;

create or replace function public.delete_task(target_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.tasks%rowtype;
begin
  perform public.assert_tasks_delete();

  select * into current_row
  from public.tasks
  where id = target_task_id
  for update;

  if current_row.id is null then
    raise exception 'Задача не найдена.';
  end if;

  delete from public.tasks
  where id = target_task_id;

  if current_row.order_id is not null then
    perform public.write_task_order_journal(
      current_row.order_id,
      'task_deleted',
      'Удалена задача «' || left(current_row.title, 120) || '»',
      jsonb_build_object('task_id', current_row.id, 'title', current_row.title)
    );
  end if;

  perform public.record_audit(
    'task.deleted',
    'task',
    target_task_id::text,
    jsonb_build_object('title', current_row.title, 'order_id', current_row.order_id)
  );
end;
$$;

revoke all on function public.assert_tasks_delete() from public;
revoke all on function public.delete_task(uuid) from public;
grant execute on function public.delete_task(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [14/73 | was 32/151] 20260828100000_order_journal_notes.sql
-- -----------------------------------------------------------------------------

-- Комментарии в журнале заказа. Файлы и внешние ссылки тоже пишутся в журнал.

create or replace function public.add_order_journal_note(
  target_order_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  body text;
begin
  if not (public.has_permission('orders:update') or public.has_permission('orders:create')) then
    raise exception 'Недостаточно прав для записи в журнал.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  body := btrim(coalesce(p_body, ''));
  if body = '' then
    raise exception 'Введите текст события.';
  end if;
  if char_length(body) > 4000 then
    raise exception 'Текст события не должен превышать 4000 символов.';
  end if;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'comment',
    auth.uid(),
    body,
    jsonb_build_object('body', body)
  )
  returning id into result_id;

  perform public.record_audit(
    'orders.journal_note',
    'order',
    target_order_id::text,
    jsonb_build_object('event_id', result_id)
  );

  return result_id;
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
  note text;
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

  note := btrim(coalesce(caption, ''));

  insert into public.order_attachments (order_id, kind, url, caption, created_by)
  values (target_order_id, 'url', normalized, note, auth.uid())
  returning id into result_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'attachment',
    auth.uid(),
    case when note = '' then 'Добавлена ссылка' else 'Добавлена ссылка: ' || left(note, 120) end,
    jsonb_build_object(
      'attachment_id', result_id,
      'kind', 'url',
      'url', normalized
    )
  );

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
  normalized_path text;
  stored_name text;
begin
  if not (public.has_permission('orders:update') or public.has_permission('orders:create')) then
    raise exception 'Недостаточно прав для добавления файла.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  normalized_path := btrim(coalesce(file_path, ''));
  if normalized_path ~ '\.\.|//' or normalized_path not like target_order_id::text || '/%' then
    raise exception 'Некорректный путь файла.';
  end if;
  if strpos(substr(normalized_path, length(target_order_id::text) + 2), '/') > 0 then
    raise exception 'Некорректный путь файла.';
  end if;

  if file_size is null or file_size < 1 or file_size > 10485760 then
    raise exception 'Размер файла превышает допустимый.';
  end if;

  if mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/jpg') then
    kind := 'photo';
  elsif mime_type = 'application/pdf' then
    kind := 'pdf';
  else
    raise exception 'Можно загрузить только фото или PDF. Видео добавляйте ссылкой.';
  end if;

  stored_name := left(btrim(coalesce(file_name, 'file')), 200);

  insert into public.order_attachments (
    order_id, kind, file_path, file_name, mime_type, file_size, caption, created_by
  )
  values (
    target_order_id,
    kind,
    normalized_path,
    stored_name,
    mime_type,
    file_size,
    btrim(coalesce(caption, '')),
    auth.uid()
  )
  returning id into result_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'attachment',
    auth.uid(),
    'Добавлен файл: ' || left(stored_name, 120),
    jsonb_build_object(
      'attachment_id', result_id,
      'kind', kind,
      'file_name', stored_name,
      'mime_type', mime_type
    )
  );

  return result_id;
end;
$$;

revoke all on function public.add_order_journal_note(uuid, text) from public, anon;
revoke all on function public.add_order_attachment_url(uuid, text, text) from public, anon;
revoke all on function public.register_order_file(uuid, text, text, text, integer, text) from public, anon;

grant execute on function public.add_order_journal_note(uuid, text) to authenticated;
grant execute on function public.add_order_attachment_url(uuid, text, text) to authenticated;
grant execute on function public.register_order_file(uuid, text, text, text, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [15/73 | was 33/151] 20260828200000_diagnostics_extra_fields.sql
-- -----------------------------------------------------------------------------

-- Тест на герметичность — обычное доп. поле протокола, не обязательное поле по умолчанию.

update public.dynamic_fields
set is_required = false
where entity_code = 'diagnostics'
  and code = 'leak_test'
  and is_required = true;

-- -----------------------------------------------------------------------------
-- [16/73 | was 34/151] 20260828300000_fix_get_order_journal.sql
-- -----------------------------------------------------------------------------

-- Журнал заказа: убрать конфликт имён RETURNS TABLE (id, event_type, ...) с колонками запроса.

create or replace function public.get_order_journal(target_order_id uuid)
returns table (
  id uuid,
  event_type text,
  summary text,
  actor_id uuid,
  actor_name text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (public.has_permission('orders:read') or public.has_permission('diagnostics:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  return query
  select
    src.id,
    src.event_type,
    src.summary,
    src.actor_id,
    src.actor_name,
    src.payload,
    src.created_at
  from (
    select
      e.id,
      e.event_type,
      e.summary,
      e.actor_id,
      coalesce(p.full_name, p.email, '')::text as actor_name,
      e.payload,
      e.created_at
    from public.order_journal_events e
    left join public.profiles p on p.id = e.actor_id
    where e.order_id = target_order_id

    union all

    select
      s.id,
      'status_changed'::text,
      case
        when s.from_status_id is null then coalesce(s.metadata ->> 'to_name', t.name)
        else coalesce(s.metadata ->> 'from_name', f.name, '') || ' → ' || coalesce(s.metadata ->> 'to_name', t.name)
      end,
      s.actor_id,
      coalesce(ap.full_name, ap.email, '')::text,
      s.metadata,
      s.created_at
    from public.order_status_events s
    left join public.reference_items f on f.id = s.from_status_id
    left join public.reference_items t on t.id = s.to_status_id
    left join public.profiles ap on ap.id = s.actor_id
    where s.order_id = target_order_id
  ) as src
  order by src.created_at desc, src.id desc;
end;
$$;

revoke all on function public.get_order_journal(uuid) from public, anon;
grant execute on function public.get_order_journal(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [17/73 | was 35/151] 20260828400000_order_status_catalog.sql
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- [18/73 | was 36/151] 20260828500000_any_order_status.sql
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- [19/73 | was 37/151] 20260828600000_delete_default_statuses.sql
-- -----------------------------------------------------------------------------

-- Можно удалить любой статус, в том числе начальный и уже использованный.

update public.reference_items r
set is_system = false
from public.reference_sets s
where s.id = r.set_id
  and s.code = 'order_statuses'
  and r.is_system = true;

create or replace function public.delete_order_status(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
  replacement_id uuid;
  was_initial boolean := false;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Статус не найден.';
  end if;

  select coalesce(m.is_initial, false) into was_initial
  from public.order_status_meta m
  where m.status_id = target_id;

  select i.id
    into replacement_id
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id and s.code = 'order_statuses'
  where i.id <> target_id
    and i.is_active
  order by i.sort_order, i.name
  limit 1;

  if replacement_id is null
     and (
       exists (select 1 from public.orders where status_id = target_id)
       or exists (select 1 from public.order_status_events where to_status_id = target_id)
     )
  then
    raise exception 'Нельзя удалить последний статус, пока есть заказы.';
  end if;

  if replacement_id is not null then
    update public.orders
    set status_id = replacement_id
    where status_id = target_id;

    update public.order_status_events
    set to_status_id = replacement_id
    where to_status_id = target_id;

    if was_initial then
      update public.order_status_meta
      set is_initial = false
      where status_id <> replacement_id;

      update public.order_status_meta
      set is_initial = true
      where status_id = replacement_id;
    end if;
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

-- -----------------------------------------------------------------------------
-- [20/73 | was 38/151] 20260828700000_update_order_customer_device.sql
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- [21/73 | was 39/151] 20260828800000_reorder_order_status_groups.sql
-- -----------------------------------------------------------------------------

-- Порядок групп статусов (колонок на доске) меняется перетаскиванием.

create or replace function public.reorder_order_status_groups(group_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  perform public.assert_settings_write();

  if group_ids is null or array_length(group_ids, 1) is null then
    raise exception 'Передайте порядок групп.';
  end if;

  select count(*) into expected_count from public.order_status_groups;

  select count(*) into matched_count
  from public.order_status_groups
  where id = any (group_ids);

  if expected_count <> array_length(group_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все группы.';
  end if;

  update public.order_status_groups g
  set sort_order = o.ord - 1
  from unnest(group_ids) with ordinality as o(id, ord)
  where g.id = o.id;

  perform public.record_audit(
    'orders.status_groups_reordered',
    'order_status_group',
    null,
    jsonb_build_object('count', expected_count)
  );
end;
$$;

revoke all on function public.reorder_order_status_groups(uuid[]) from public, anon;
grant execute on function public.reorder_order_status_groups(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- [22/73 | was 40/151] 20260828900000_order_file_size_5gb.sql
-- -----------------------------------------------------------------------------

-- Вложения заказа: пустые файлы допустимы, лимит 5 ГБ.
-- integer не вмещает 5 ГБ, поэтому размер хранится как bigint.

alter table public.order_attachments
  alter column file_size type bigint;

update storage.buckets
set file_size_limit = 5368709120
where id = 'order-attachments';

drop function if exists public.register_order_file(uuid, text, text, text, integer, text);
drop function if exists public.register_order_file(uuid, text, text, text, bigint, text);

create or replace function public.register_order_file(
  target_order_id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size bigint,
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
  normalized_path text;
  stored_name text;
begin
  if not (public.has_permission('orders:update') or public.has_permission('orders:create')) then
    raise exception 'Недостаточно прав для добавления файла.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  normalized_path := btrim(coalesce(file_path, ''));
  if normalized_path ~ '\.\.|//' or normalized_path not like target_order_id::text || '/%' then
    raise exception 'Некорректный путь файла.';
  end if;
  if strpos(substr(normalized_path, length(target_order_id::text) + 2), '/') > 0 then
    raise exception 'Некорректный путь файла.';
  end if;

  if file_size is null or file_size < 0 or file_size > 5368709120 then
    raise exception 'Размер файла превышает допустимый.';
  end if;

  if mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/jpg') then
    kind := 'photo';
  elsif mime_type = 'application/pdf' then
    kind := 'pdf';
  else
    raise exception 'Можно загрузить только фото или PDF. Видео добавляйте ссылкой.';
  end if;

  stored_name := left(btrim(coalesce(file_name, 'file')), 200);

  insert into public.order_attachments (
    order_id, kind, file_path, file_name, mime_type, file_size, caption, created_by
  )
  values (
    target_order_id,
    kind,
    normalized_path,
    stored_name,
    mime_type,
    file_size,
    btrim(coalesce(caption, '')),
    auth.uid()
  )
  returning id into result_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'attachment',
    auth.uid(),
    'Добавлен файл: ' || left(stored_name, 120),
    jsonb_build_object(
      'attachment_id', result_id,
      'kind', kind,
      'file_name', stored_name,
      'mime_type', mime_type
    )
  );

  return result_id;
end;
$$;

revoke all on function public.register_order_file(uuid, text, text, text, bigint, text) from public, anon;
grant execute on function public.register_order_file(uuid, text, text, text, bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [23/73 | was 41/151] 20260829100000_fix_list_inventory_count_lines.sql
-- -----------------------------------------------------------------------------

-- Строки инвентаризации: конфликт имён RETURNS TABLE (id, difference, ...) с колонками запроса.

create or replace function public.list_inventory_count_lines(
  target_count_id uuid,
  search_query text default '',
  line_filter text default 'all',
  page_number integer default 1,
  page_size integer default 50
)
returns table (
  id uuid,
  item_id uuid,
  item_name text,
  item_code text,
  item_article text,
  item_barcode text,
  unit_name text,
  expected_quantity numeric,
  actual_quantity numeric,
  difference numeric,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  term text;
  filter_value text;
  safe_page integer;
  safe_size integer;
begin
  perform public.assert_inventory_count_permission();

  if not exists (select 1 from public.inventory_counts where id = target_count_id) then
    raise exception 'Документ инвентаризации не найден.';
  end if;

  filter_value := coalesce(nullif(btrim(line_filter), ''), 'all');
  if filter_value not in ('all', 'uncounted', 'counted', 'discrepancy') then
    raise exception 'Неизвестный фильтр строк.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 50), 1), 100);

  return query
  select
    l.id,
    l.item_id,
    i.name as item_name,
    i.code as item_code,
    i.article as item_article,
    i.barcode as item_barcode,
    coalesce(u.name, '') as unit_name,
    l.expected_quantity,
    l.actual_quantity,
    l.difference,
    l.created_at,
    count(*) over() as total_count
  from public.inventory_count_lines l
  join public.inventory_items i on i.id = l.item_id
  left join public.reference_items u on u.id = i.unit_id
  where l.count_id = target_count_id
    and (
      btrim(coalesce(search_query, '')) = ''
      or i.name ilike term escape '\'
      or i.code ilike term escape '\'
      or i.article ilike term escape '\'
      or i.barcode ilike term escape '\'
    )
    and (
      filter_value = 'all'
      or (filter_value = 'uncounted' and l.actual_quantity is null)
      or (filter_value = 'counted' and l.actual_quantity is not null)
      or (filter_value = 'discrepancy' and l.actual_quantity is not null and l.difference <> 0)
    )
  order by
    case when l.actual_quantity is null then 0 else 1 end,
    i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.list_inventory_count_lines(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_inventory_count_lines(uuid, text, text, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- [24/73 | was 42/151] 20260829200000_delete_inventory_count.sql
-- -----------------------------------------------------------------------------

-- Удаление черновика, пересчёта в работе или отменённого документа. Проведённый нельзя удалить: по нему есть журнал.

create or replace function public.delete_inventory_count(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
begin
  perform public.assert_inventory_count_permission();

  current_row := public.lock_inventory_count(target_count_id);

  if current_row.status = 'completed' then
    raise exception 'Проведённую инвентаризацию нельзя удалить.';
  end if;

  if exists (
    select 1
    from public.inventory_movements
    where reference_type = 'inventory_count' and reference_id = target_count_id
  ) then
    raise exception 'Документ связан с движениями журнала, удаление невозможно.';
  end if;

  delete from public.inventory_counts
  where id = target_count_id;

  perform public.record_audit(
    'inventory.count_deleted',
    'inventory_count',
    target_count_id::text,
    jsonb_build_object('number', current_row.number, 'status', current_row.status)
  );
end;
$$;

revoke all on function public.delete_inventory_count(uuid) from public, anon;
grant execute on function public.delete_inventory_count(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [25/73 | was 43/151] 20260829210000_order_card_fields.sql
-- -----------------------------------------------------------------------------

-- Поля карточки заказа: сопроводительная записка, комплектация, срок, ответственный.
-- Значения по-прежнему в public.orders; определения — в Полях карточек, группа «Заказ».

insert into public.dynamic_field_types (code, name, sort_order)
values
  ('text', 'Строка', 0),
  ('textarea', 'Многострочный текст', 1),
  ('number', 'Число', 2),
  ('date', 'Дата', 3),
  ('select', 'Список', 4),
  ('employee', 'Сотрудник', 5),
  ('checkbox', 'Флажок', 6)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order;

update public.dynamic_fields
set sort_order = sort_order + 10
where entity_code = 'orders';

insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
values
  ('orders', 'claimed_malfunction', 'Сопроводительная записка', 'textarea', true, 0, 'Заказ'),
  ('orders', 'completeness', 'Комплектация', 'textarea', false, 1, 'Заказ'),
  ('orders', 'deadline', 'Срок', 'date', false, 2, 'Заказ'),
  ('orders', 'responsible', 'Ответственный', 'employee', false, 3, 'Заказ')
on conflict (entity_code, code) do update
set group_name = case
  when public.dynamic_fields.group_name = '' then excluded.group_name
  else public.dynamic_fields.group_name
end;

create or replace function public.is_order_card_field(p_entity text, p_code text)
returns boolean
language sql
immutable
as $$
  select p_entity = 'orders'
    and p_code in ('claimed_malfunction', 'completeness', 'deadline', 'responsible');
$$;

create or replace function public.delete_dynamic_field(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.dynamic_fields%rowtype;
begin
  perform public.assert_settings_write();

  select * into current_row from public.dynamic_fields where id = target_id;
  if current_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  if public.is_order_card_field(current_row.entity_code, current_row.code) then
    raise exception 'Системное поле заказа нельзя удалить. Скройте его, если оно не нужно в форме.';
  end if;

  delete from public.dynamic_field_values where field_id = target_id;
  delete from public.dynamic_fields where id = target_id;

  perform public.record_audit(
    'fields.deleted',
    'dynamic_field',
    target_id::text,
    jsonb_build_object('entity_code', current_row.entity_code, 'code', current_row.code, 'name', current_row.name)
  );
end;
$$;

create or replace function public.save_dynamic_field_values(
  target_entity_code text,
  target_record_id uuid,
  field_values jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  field_row public.dynamic_fields%rowtype;
  raw jsonb;
  permission_code text;
begin
  if not public.is_active_user() then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.field_entities where code = target_entity_code) then
    raise exception 'Раздел карточки не найден.';
  end if;

  permission_code := target_entity_code || ':update';
  if target_entity_code = 'diagnostics' then
    permission_code := 'diagnostics:update';
  end if;
  if target_entity_code = 'inventory' then
    permission_code := 'inventory:receive';
  end if;

  if not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
  end if;

  for field_row in
    select *
    from public.dynamic_fields
    where entity_code = target_entity_code
      and is_active = true
  loop
    if public.is_order_card_field(field_row.entity_code, field_row.code) then
      continue;
    end if;

    raw := field_values -> field_row.code;
    perform public.validate_dynamic_field_value(field_row.id, raw);

    if raw is null or raw = 'null'::jsonb or (jsonb_typeof(raw) = 'string' and btrim(raw #>> '{}') = '') then
      delete from public.dynamic_field_values
      where field_id = field_row.id
        and record_id = target_record_id;
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
    end if;
  end loop;
end;
$$;

create or replace function public.upsert_dynamic_field(
  target_id uuid,
  entity_code text,
  field_code text,
  field_name text,
  field_type text,
  is_required boolean default false,
  options jsonb default '[]'::jsonb,
  group_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p_entity text := entity_code;
  p_type text := field_type;
  p_required boolean := coalesce(is_required, false);
  p_options jsonb := coalesce(options, '[]'::jsonb);
  normalized_code text;
  normalized_name text;
  normalized_group text;
  current_row public.dynamic_fields%rowtype;
  result_id uuid;
  next_sort integer;
  usage_count integer;
  is_system boolean := false;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.field_entities where code = p_entity) then
    raise exception 'Раздел карточки не найден.';
  end if;

  if not exists (select 1 from public.dynamic_field_types where code = p_type) then
    raise exception 'Неизвестный тип поля.';
  end if;

  normalized_code := lower(btrim(coalesce(field_code, '')));
  normalized_name := btrim(coalesce(field_name, ''));
  normalized_group := left(btrim(coalesce(group_name, '')), 80);

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if p_type = 'select' and (jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 1) then
    raise exception 'Для списка добавьте хотя бы один вариант.';
  end if;

  if target_id is not null then
    select * into current_row from public.dynamic_fields where id = target_id and dynamic_fields.entity_code = p_entity;
    if current_row.id is null then
      raise exception 'Поле не найдено.';
    end if;

    is_system := public.is_order_card_field(current_row.entity_code, current_row.code);

    if is_system then
      if normalized_code <> current_row.code then
        raise exception 'Код системного поля заказа нельзя изменить.';
      end if;
      if p_type <> current_row.field_type then
        raise exception 'Тип системного поля заказа нельзя изменить.';
      end if;
    end if;

    usage_count := public.dynamic_field_usage_count(current_row.id);
    if usage_count > 0 and current_row.field_type <> p_type then
      raise exception 'Нельзя сменить тип поля, которое уже используется в данных.';
    end if;

    if current_row.code <> normalized_code and usage_count > 0 then
      raise exception 'Нельзя сменить код поля, которое уже используется в данных.';
    end if;

    update public.dynamic_fields
    set
      code = case when is_system or usage_count > 0 then current_row.code else normalized_code end,
      name = normalized_name,
      field_type = case when is_system then current_row.field_type else p_type end,
      is_required = p_required,
      group_name = normalized_group
    where id = current_row.id
    returning id into result_id;
  else
    if public.is_order_card_field(p_entity, normalized_code) then
      raise exception 'Этот код зарезервирован для системного поля заказа.';
    end if;

    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.dynamic_fields
    where dynamic_fields.entity_code = p_entity;

    insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
    values (
      p_entity,
      normalized_code,
      normalized_name,
      p_type,
      p_required,
      next_sort,
      normalized_group
    )
    returning id into result_id;
  end if;

  if p_type = 'select' then
    perform public.replace_dynamic_field_options(result_id, p_options);
    if not exists (
      select 1 from public.dynamic_field_options
      where field_id = result_id and is_active = true
    ) then
      raise exception 'Для списка добавьте хотя бы один активный вариант.';
    end if;
  else
    update public.dynamic_field_options
    set is_active = false
    where field_id = result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'fields.created' else 'fields.updated' end,
    'dynamic_field',
    result_id::text,
    jsonb_build_object('entity_code', p_entity, 'code', normalized_code, 'field_type', p_type)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Поле с таким кодом уже есть в этом разделе.';
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

-- -----------------------------------------------------------------------------
-- [26/73 | was 44/151] 20260829220000_dynamic_field_types.sql
-- -----------------------------------------------------------------------------

-- Типы полей карточек: многострочный текст, дата, сотрудник, флажок.
-- Системные поля заказа получают настоящие типы вместо «text».

insert into public.dynamic_field_types (code, name, sort_order)
values
  ('text', 'Строка', 0),
  ('textarea', 'Многострочный текст', 1),
  ('number', 'Число', 2),
  ('date', 'Дата', 3),
  ('select', 'Список', 4),
  ('employee', 'Сотрудник', 5),
  ('checkbox', 'Флажок', 6)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order;

update public.dynamic_fields
set field_type = 'textarea'
where entity_code = 'orders'
  and code in ('claimed_malfunction', 'completeness')
  and field_type = 'text';

update public.dynamic_fields
set field_type = 'date'
where entity_code = 'orders'
  and code = 'deadline'
  and field_type = 'text';

update public.dynamic_fields
set field_type = 'employee'
where entity_code = 'orders'
  and code = 'responsible'
  and field_type = 'text';

create or replace function public.validate_dynamic_field_value(target_field_id uuid, raw jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  field_row public.dynamic_fields%rowtype;
  value_type text;
  option_code text;
  text_value text;
begin
  select * into field_row from public.dynamic_fields where id = target_field_id;
  if field_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  if raw is null or raw = 'null'::jsonb then
    if field_row.is_required and field_row.is_active then
      raise exception 'Заполните обязательное поле.';
    end if;
    return;
  end if;

  value_type := jsonb_typeof(raw);

  if field_row.field_type in ('text', 'textarea') then
    if value_type <> 'string' then
      raise exception 'Ожидается текстовое значение.';
    end if;
    if field_row.is_required and btrim(raw #>> '{}') = '' then
      raise exception 'Заполните обязательное поле.';
    end if;
    return;
  end if;

  if field_row.field_type = 'number' then
    if value_type <> 'number' then
      raise exception 'Ожидается числовое значение.';
    end if;
    return;
  end if;

  if field_row.field_type = 'date' then
    if value_type <> 'string' then
      raise exception 'Укажите дату.';
    end if;
    text_value := btrim(raw #>> '{}');
    if text_value = '' then
      if field_row.is_required then
        raise exception 'Укажите дату.';
      end if;
      return;
    end if;
    if text_value !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Дата должна быть в формате ГГГГ-ММ-ДД.';
    end if;
    return;
  end if;

  if field_row.field_type = 'employee' then
    if value_type <> 'string' then
      raise exception 'Выберите сотрудника.';
    end if;
    text_value := btrim(raw #>> '{}');
    if text_value = '' then
      if field_row.is_required then
        raise exception 'Выберите сотрудника.';
      end if;
      return;
    end if;
    if not exists (
      select 1 from public.profiles
      where id::text = text_value and is_active = true
    ) then
      raise exception 'Сотрудник не найден.';
    end if;
    return;
  end if;

  if field_row.field_type = 'checkbox' then
    if value_type <> 'boolean' then
      raise exception 'Ожидается флажок.';
    end if;
    if field_row.is_required and raw is distinct from 'true'::jsonb then
      raise exception 'Отметьте поле.';
    end if;
    return;
  end if;

  if field_row.field_type = 'select' then
    if value_type <> 'string' then
      raise exception 'Выберите значение из списка.';
    end if;
    option_code := raw #>> '{}';
    if not exists (
      select 1
      from public.dynamic_field_options
      where field_id = field_row.id
        and code = option_code
        and is_active = true
    ) then
      raise exception 'Выбранный вариант недоступен.';
    end if;
    return;
  end if;

  raise exception 'Неподдерживаемый тип поля.';
end;
$$;

-- -----------------------------------------------------------------------------
-- [27/73 | was 45/151] 20260829230000_order_fields_user_owned.sql
-- -----------------------------------------------------------------------------

-- Поля заказа в настройках — обычные пользовательские: можно менять тип и удалять.

create or replace function public.delete_dynamic_field(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.dynamic_fields%rowtype;
begin
  perform public.assert_settings_write();

  select * into current_row from public.dynamic_fields where id = target_id;
  if current_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  delete from public.dynamic_field_values where field_id = target_id;
  delete from public.dynamic_fields where id = target_id;

  perform public.record_audit(
    'fields.deleted',
    'dynamic_field',
    target_id::text,
    jsonb_build_object('entity_code', current_row.entity_code, 'code', current_row.code, 'name', current_row.name)
  );
end;
$$;

create or replace function public.upsert_dynamic_field(
  target_id uuid,
  entity_code text,
  field_code text,
  field_name text,
  field_type text,
  is_required boolean default false,
  options jsonb default '[]'::jsonb,
  group_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p_entity text := entity_code;
  p_type text := field_type;
  p_required boolean := coalesce(is_required, false);
  p_options jsonb := coalesce(options, '[]'::jsonb);
  normalized_code text;
  normalized_name text;
  normalized_group text;
  current_row public.dynamic_fields%rowtype;
  result_id uuid;
  next_sort integer;
  usage_count integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.field_entities where code = p_entity) then
    raise exception 'Раздел карточки не найден.';
  end if;

  if not exists (select 1 from public.dynamic_field_types where code = p_type) then
    raise exception 'Неизвестный тип поля.';
  end if;

  normalized_code := lower(btrim(coalesce(field_code, '')));
  normalized_name := btrim(coalesce(field_name, ''));
  normalized_group := left(btrim(coalesce(group_name, '')), 80);

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if p_type = 'select' and (jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 1) then
    raise exception 'Для списка добавьте хотя бы один вариант.';
  end if;

  if target_id is not null then
    select * into current_row from public.dynamic_fields where id = target_id and dynamic_fields.entity_code = p_entity;
    if current_row.id is null then
      raise exception 'Поле не найдено.';
    end if;

    usage_count := public.dynamic_field_usage_count(current_row.id);
    if usage_count > 0 and current_row.field_type <> p_type then
      raise exception 'Нельзя сменить тип поля, которое уже используется в данных.';
    end if;

    if current_row.code <> normalized_code and usage_count > 0 then
      raise exception 'Нельзя сменить код поля, которое уже используется в данных.';
    end if;

    update public.dynamic_fields
    set
      code = case when usage_count > 0 then current_row.code else normalized_code end,
      name = normalized_name,
      field_type = p_type,
      is_required = p_required,
      group_name = normalized_group
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.dynamic_fields
    where dynamic_fields.entity_code = p_entity;

    insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
    values (
      p_entity,
      normalized_code,
      normalized_name,
      p_type,
      p_required,
      next_sort,
      normalized_group
    )
    returning id into result_id;
  end if;

  if p_type = 'select' then
    perform public.replace_dynamic_field_options(result_id, p_options);
    if not exists (
      select 1 from public.dynamic_field_options
      where field_id = result_id and is_active = true
    ) then
      raise exception 'Для списка добавьте хотя бы один активный вариант.';
    end if;
  else
    update public.dynamic_field_options
    set is_active = false
    where field_id = result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'fields.created' else 'fields.updated' end,
    'dynamic_field',
    result_id::text,
    jsonb_build_object('entity_code', p_entity, 'code', normalized_code, 'field_type', p_type)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Поле с таким кодом уже есть в этом разделе.';
end;
$$;

-- -----------------------------------------------------------------------------
-- [28/73 | was 46/151] 20260829240000_field_layout.sql
-- -----------------------------------------------------------------------------

-- Ширина и высота дополнительных полей на карточке. Настраиваются в предпросмотре.

alter table public.dynamic_fields
  add column if not exists layout_width text not null default 'half',
  add column if not exists layout_height text not null default 'default';

alter table public.dynamic_fields
  drop constraint if exists dynamic_fields_layout_width_check,
  drop constraint if exists dynamic_fields_layout_height_check;

alter table public.dynamic_fields
  add constraint dynamic_fields_layout_width_check
    check (layout_width in ('quarter', 'third', 'half', 'two_thirds', 'three_quarters', 'full')),
  add constraint dynamic_fields_layout_height_check
    check (layout_height in ('compact', 'default', 'tall', 'extra'));

update public.dynamic_fields
set layout_width = 'full', layout_height = 'tall'
where field_type = 'textarea';

update public.dynamic_fields
set layout_width = 'half', layout_height = 'compact'
where field_type = 'checkbox';

drop function if exists public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text);

create or replace function public.upsert_dynamic_field(
  target_id uuid,
  entity_code text,
  field_code text,
  field_name text,
  field_type text,
  is_required boolean default false,
  options jsonb default '[]'::jsonb,
  group_name text default '',
  layout_width text default 'half',
  layout_height text default 'default'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p_entity text := entity_code;
  p_type text := field_type;
  p_required boolean := coalesce(is_required, false);
  p_options jsonb := coalesce(options, '[]'::jsonb);
  p_width text := coalesce(nullif(btrim(layout_width), ''), 'half');
  p_height text := coalesce(nullif(btrim(layout_height), ''), 'default');
  normalized_code text;
  normalized_name text;
  normalized_group text;
  current_row public.dynamic_fields%rowtype;
  result_id uuid;
  next_sort integer;
  usage_count integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.field_entities where code = p_entity) then
    raise exception 'Раздел карточки не найден.';
  end if;

  if not exists (select 1 from public.dynamic_field_types where code = p_type) then
    raise exception 'Неизвестный тип поля.';
  end if;

  if p_width not in ('quarter', 'third', 'half', 'two_thirds', 'three_quarters', 'full') then
    raise exception 'Недопустимая ширина поля.';
  end if;

  if p_height not in ('compact', 'default', 'tall', 'extra') then
    raise exception 'Недопустимая высота поля.';
  end if;

  normalized_code := lower(btrim(coalesce(field_code, '')));
  normalized_name := btrim(coalesce(field_name, ''));
  normalized_group := left(btrim(coalesce(group_name, '')), 80);

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if p_type = 'select' and (jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 1) then
    raise exception 'Для списка добавьте хотя бы один вариант.';
  end if;

  if target_id is not null then
    select * into current_row from public.dynamic_fields where id = target_id and dynamic_fields.entity_code = p_entity;
    if current_row.id is null then
      raise exception 'Поле не найдено.';
    end if;

    usage_count := public.dynamic_field_usage_count(current_row.id);
    if usage_count > 0 and current_row.field_type <> p_type then
      raise exception 'Нельзя сменить тип поля, которое уже используется в данных.';
    end if;

    if current_row.code <> normalized_code and usage_count > 0 then
      raise exception 'Нельзя сменить код поля, которое уже используется в данных.';
    end if;

    update public.dynamic_fields
    set
      code = case when usage_count > 0 then current_row.code else normalized_code end,
      name = normalized_name,
      field_type = p_type,
      is_required = p_required,
      group_name = normalized_group,
      layout_width = p_width,
      layout_height = p_height
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.dynamic_fields
    where dynamic_fields.entity_code = p_entity;

    insert into public.dynamic_fields (
      entity_code, code, name, field_type, is_required, sort_order, group_name, layout_width, layout_height
    )
    values (
      p_entity,
      normalized_code,
      normalized_name,
      p_type,
      p_required,
      next_sort,
      normalized_group,
      p_width,
      p_height
    )
    returning id into result_id;
  end if;

  if p_type = 'select' then
    perform public.replace_dynamic_field_options(result_id, p_options);
    if not exists (
      select 1 from public.dynamic_field_options
      where field_id = result_id and is_active = true
    ) then
      raise exception 'Для списка добавьте хотя бы один активный вариант.';
    end if;
  else
    update public.dynamic_field_options
    set is_active = false
    where field_id = result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'fields.created' else 'fields.updated' end,
    'dynamic_field',
    result_id::text,
    jsonb_build_object(
      'entity_code', p_entity,
      'code', normalized_code,
      'field_type', p_type,
      'layout_width', p_width,
      'layout_height', p_height
    )
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Поле с таким кодом уже есть в этом разделе.';
end;
$$;

create or replace function public.set_dynamic_field_layout(
  target_id uuid,
  next_width text,
  next_height text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.dynamic_fields%rowtype;
  p_width text := coalesce(nullif(btrim(next_width), ''), 'half');
  p_height text := coalesce(nullif(btrim(next_height), ''), 'default');
begin
  perform public.assert_settings_write();

  if p_width not in ('quarter', 'third', 'half', 'two_thirds', 'three_quarters', 'full') then
    raise exception 'Недопустимая ширина поля.';
  end if;

  if p_height not in ('compact', 'default', 'tall', 'extra') then
    raise exception 'Недопустимая высота поля.';
  end if;

  select * into current_row from public.dynamic_fields where id = target_id;
  if current_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  update public.dynamic_fields
  set layout_width = p_width, layout_height = p_height
  where id = current_row.id;

  perform public.record_audit(
    'fields.layout',
    'dynamic_field',
    current_row.id::text,
    jsonb_build_object(
      'entity_code', current_row.entity_code,
      'code', current_row.code,
      'layout_width', p_width,
      'layout_height', p_height
    )
  );
end;
$$;

revoke all on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text, text, text) from public;
revoke all on function public.set_dynamic_field_layout(uuid, text, text) from public;

grant execute on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text, text, text) to authenticated;
grant execute on function public.set_dynamic_field_layout(uuid, text, text) to authenticated;
grant execute on function public.set_dynamic_field_layout(uuid, text, text) to service_role;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [29/73 | was 47/151] 20260829250000_device_display_name.sql
-- -----------------------------------------------------------------------------

-- Название прибора: тип → производитель → модель. Серийный номер отдельно.

create or replace function public.device_display_name(group_name text, brand_name text, model_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      concat_ws(
        ' · ',
        nullif(btrim(coalesce(group_name, '')), ''),
        nullif(btrim(coalesce(brand_name, '')), ''),
        nullif(btrim(coalesce(model_name, '')), '')
      ),
      ''
    ),
    'Прибор'
  );
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
  public.device_display_name(grp.name, brand.name, model.name) as label,
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
  public.device_display_name(grp.name, brand.name, model.name) as device_label,
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
left join public.reference_items grp on grp.id = d.group_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id;

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
    'label', public.device_display_name(grp.name, brand.name, model.name),
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
          'label', public.device_display_name(grp.name, brand.name, model.name),
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
    'Прибор: серийный номер ' || coalesce(nullif(old.serial_number, ''), '—')
      || ' → серийный номер ' || coalesce(nullif(new.serial_number, ''), '—'),
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

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [30/73 | was 48/151] 20260829260000_allow_change_field_type.sql
-- -----------------------------------------------------------------------------

-- Тип дополнительного поля можно менять, даже если оно уже заполнено в записях.

create or replace function public.upsert_dynamic_field(
  target_id uuid,
  entity_code text,
  field_code text,
  field_name text,
  field_type text,
  is_required boolean default false,
  options jsonb default '[]'::jsonb,
  group_name text default '',
  layout_width text default 'half',
  layout_height text default 'default'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p_entity text := entity_code;
  p_type text := field_type;
  p_required boolean := coalesce(is_required, false);
  p_options jsonb := coalesce(options, '[]'::jsonb);
  p_width text := coalesce(nullif(btrim(layout_width), ''), 'half');
  p_height text := coalesce(nullif(btrim(layout_height), ''), 'default');
  normalized_code text;
  normalized_name text;
  normalized_group text;
  current_row public.dynamic_fields%rowtype;
  result_id uuid;
  next_sort integer;
  usage_count integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.field_entities where code = p_entity) then
    raise exception 'Раздел карточки не найден.';
  end if;

  if not exists (select 1 from public.dynamic_field_types where code = p_type) then
    raise exception 'Неизвестный тип поля.';
  end if;

  if p_width not in ('quarter', 'third', 'half', 'two_thirds', 'three_quarters', 'full') then
    raise exception 'Недопустимая ширина поля.';
  end if;

  if p_height not in ('compact', 'default', 'tall', 'extra') then
    raise exception 'Недопустимая высота поля.';
  end if;

  normalized_code := lower(btrim(coalesce(field_code, '')));
  normalized_name := btrim(coalesce(field_name, ''));
  normalized_group := left(btrim(coalesce(group_name, '')), 80);

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if p_type = 'select' and (jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 1) then
    raise exception 'Для списка добавьте хотя бы один вариант.';
  end if;

  if target_id is not null then
    select * into current_row from public.dynamic_fields where id = target_id and dynamic_fields.entity_code = p_entity;
    if current_row.id is null then
      raise exception 'Поле не найдено.';
    end if;

    usage_count := public.dynamic_field_usage_count(current_row.id);

    if current_row.code <> normalized_code and usage_count > 0 then
      raise exception 'Нельзя сменить код поля, которое уже используется в данных.';
    end if;

    update public.dynamic_fields
    set
      code = case when usage_count > 0 then current_row.code else normalized_code end,
      name = normalized_name,
      field_type = p_type,
      is_required = p_required,
      group_name = normalized_group,
      layout_width = p_width,
      layout_height = p_height
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.dynamic_fields
    where dynamic_fields.entity_code = p_entity;

    insert into public.dynamic_fields (
      entity_code, code, name, field_type, is_required, sort_order, group_name, layout_width, layout_height
    )
    values (
      p_entity,
      normalized_code,
      normalized_name,
      p_type,
      p_required,
      next_sort,
      normalized_group,
      p_width,
      p_height
    )
    returning id into result_id;
  end if;

  if p_type = 'select' then
    perform public.replace_dynamic_field_options(result_id, p_options);
    if not exists (
      select 1 from public.dynamic_field_options
      where field_id = result_id and is_active = true
    ) then
      raise exception 'Для списка добавьте хотя бы один активный вариант.';
    end if;
  else
    update public.dynamic_field_options
    set is_active = false
    where field_id = result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'fields.created' else 'fields.updated' end,
    'dynamic_field',
    result_id::text,
    jsonb_build_object(
      'entity_code', p_entity,
      'code', normalized_code,
      'field_type', p_type,
      'layout_width', p_width,
      'layout_height', p_height
    )
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Поле с таким кодом уже есть в этом разделе.';
end;
$$;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [31/73 | was 49/151] 20260829270000_delete_order.sql
-- -----------------------------------------------------------------------------

-- Удаление заказа. Право: orders:delete. Журнал склада не трогаем.

create or replace function public.delete_order(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
begin
  if not public.has_permission('orders:delete') then
    raise exception 'Недостаточно прав для удаления заказа.';
  end if;

  select * into current_row
  from public.orders
  where id = target_order_id
  for update;

  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  delete from public.device_warranties
  where order_id = target_order_id;

  delete from public.documents
  where source_type = 'order' and source_id = target_order_id;

  delete from public.dynamic_field_values
  where record_id = target_order_id
    and entity_code in ('orders', 'diagnostics');

  delete from public.orders
  where id = target_order_id;

  perform public.record_audit(
    'orders.deleted',
    'order',
    target_order_id::text,
    jsonb_build_object('number', current_row.number)
  );
end;
$$;

revoke all on function public.delete_order(uuid) from public, anon;
grant execute on function public.delete_order(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [32/73 | was 50/151] 20260829280000_diagnostics_protocol.sql
-- -----------------------------------------------------------------------------

-- Диагностика: протокол без заключения и инженера. Дата обновляется при каждом сохранении.

create or replace function public.save_order_diagnostics(
  target_order_id uuid,
  conclusion text default null,
  target_engineer_id uuid default null,
  field_values jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was_new boolean;
  old_fields jsonb := '{}'::jsonb;
  changes jsonb := '[]'::jsonb;
  field_row record;
  old_value jsonb;
  new_value jsonb;
begin
  if not public.has_permission('diagnostics:update') then
    raise exception 'Недостаточно прав для записи диагностики.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  was_new := not exists (select 1 from public.order_diagnostics where order_id = target_order_id);

  if not was_new then
    select coalesce(jsonb_object_agg(f.code, v.value), '{}'::jsonb)
      into old_fields
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id and v.record_id = target_order_id
    where f.entity_code = 'diagnostics';
  end if;

  insert into public.order_diagnostics (
    order_id, conclusion, engineer_id, created_by, updated_by, created_at, updated_at
  )
  values (
    target_order_id, '', null, auth.uid(), auth.uid(), now(), now()
  )
  on conflict (order_id) do update
    set updated_by = excluded.updated_by,
        updated_at = now();

  perform public.save_dynamic_field_values('diagnostics', target_order_id, coalesce(field_values, '{}'::jsonb));

  for field_row in
    select f.code, f.name
    from public.dynamic_fields f
    where f.entity_code = 'diagnostics' and f.is_active = true
    order by f.sort_order, f.name
  loop
    old_value := old_fields -> field_row.code;
    new_value := coalesce(field_values, '{}'::jsonb) -> field_row.code;
    if old_value = 'null'::jsonb then
      old_value := null;
    end if;
    if new_value = 'null'::jsonb or (jsonb_typeof(new_value) = 'string' and btrim(new_value #>> '{}') = '') then
      new_value := null;
    end if;
    if old_value is distinct from new_value then
      changes := changes || jsonb_build_array(jsonb_build_object(
        'field', field_row.code,
        'label', field_row.name,
        'from', old_value,
        'to', new_value
      ));
    end if;
  end loop;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    case when was_new then 'diagnostics_created' else 'diagnostics_updated' end,
    auth.uid(),
    case when was_new then 'Создана диагностика' else 'Обновлена диагностика' end,
    jsonb_build_object('changes', changes)
  );

  perform public.record_audit(
    case when was_new then 'orders.diagnostics_created' else 'orders.diagnostics_updated' end,
    'order',
    target_order_id::text,
    jsonb_build_object('changes', changes)
  );
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
    );
  end if;

  if rule_code = 'responsible_assigned' then
    return target_order.responsible_id is not null;
  end if;

  return false;
end;
$$;

update public.transition_rule_types
set
  name = 'Протокол диагностики',
  description = 'Нужен сохранённый протокол диагностики'
where code = 'diagnostics_conclusion';

-- -----------------------------------------------------------------------------
-- [33/73 | was 51/151] 20260829290000_fix_update_order.sql
-- -----------------------------------------------------------------------------

-- Одна сигнатура update_order: без перегрузок, с правами и обновлением кэша PostgREST.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_order'
  loop
    execute 'drop function if exists ' || fn.signature;
  end loop;
end
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
) from public, anon;
grant execute on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean
) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [34/73 | was 52/151] 20260829300000_search_customers_kind.sql
-- -----------------------------------------------------------------------------

-- Поиск контактов с фильтром по типу: люди / организации.

drop function if exists public.search_customers(text, integer, integer, boolean);

create function public.search_customers(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  active_only boolean default false,
  kind_filter text default null
)
returns table (
  id uuid,
  kind text,
  name text,
  inn text,
  kpp text,
  ogrn text,
  phone text,
  email text,
  city text,
  contact_name text,
  notes text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  safe_page integer;
  safe_size integer;
  safe_kind text;
begin
  if not (
    public.has_permission('customers:read')
    or public.has_permission('orders:read')
    or public.has_permission('orders:create')
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  term := replace(replace(btrim(coalesce(search_query, '')), '%', ''), '_', '');
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);
  safe_kind := btrim(coalesce(kind_filter, ''));
  if safe_kind <> '' and safe_kind not in ('organization', 'individual') then
    raise exception 'Некорректный тип контакта.';
  end if;

  return query
  select
    c.id,
    c.kind,
    c.name,
    c.inn,
    c.kpp,
    c.ogrn,
    c.phone,
    c.email,
    c.city,
    c.contact_name,
    c.notes,
    c.is_active,
    c.created_at,
    c.updated_at,
    count(*) over() as total_count
  from public.customers c
  where (not active_only or c.is_active = true)
    and (safe_kind = '' or c.kind = safe_kind)
    and (
      term = ''
      or c.name ilike '%' || term || '%'
      or c.contact_name ilike '%' || term || '%'
      or c.phone ilike '%' || term || '%'
      or c.email ilike '%' || term || '%'
      or c.inn ilike '%' || term || '%'
      or c.kpp ilike '%' || term || '%'
      or c.ogrn ilike '%' || term || '%'
      or c.city ilike '%' || term || '%'
    )
  order by c.name, c.created_at
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.search_customers(text, integer, integer, boolean, text) from public, anon;
grant execute on function public.search_customers(text, integer, integer, boolean, text) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [35/73 | was 53/151] 20260829310000_delete_order_attachment.sql
-- -----------------------------------------------------------------------------

-- Удаление вложения заказа: запись в журнале, строка вложения, аудит.

create or replace function public.delete_order_attachment(target_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_attachments%rowtype;
  stored_name text;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для удаления файла.';
  end if;

  select * into current_row
  from public.order_attachments
  where id = target_attachment_id
  for update;

  if current_row.id is null then
    raise exception 'Файл не найден.';
  end if;

  stored_name := coalesce(nullif(btrim(current_row.file_name), ''), nullif(btrim(current_row.caption), ''), 'файл');

  delete from public.order_attachments
  where id = target_attachment_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'attachment',
    auth.uid(),
    'Удалён файл: ' || left(stored_name, 120),
    jsonb_build_object(
      'attachment_id', current_row.id,
      'kind', current_row.kind,
      'file_name', current_row.file_name,
      'deleted', true
    )
  );

  perform public.record_audit(
    'orders.attachment_deleted',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'attachment_id', current_row.id,
      'file_name', current_row.file_name
    )
  );
end;
$$;

revoke all on function public.delete_order_attachment(uuid) from public, anon;
grant execute on function public.delete_order_attachment(uuid) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [36/73 | was 54/151] 20260829320000_task_due_datetime.sql
-- -----------------------------------------------------------------------------

-- Срок задачи: дата и время (timestamptz), а не только день.

alter table public.tasks
  alter column due_date type timestamptz
  using case
    when due_date is null then null
    else (due_date::timestamp without time zone) at time zone 'Europe/Moscow'
  end;

drop function if exists public.create_task(text, text, uuid, date, text, uuid);
drop function if exists public.update_task(uuid, text, text, uuid, date, text);
drop function if exists public.list_tasks(text, text, text, text, text, text, uuid, integer, integer);

create function public.create_task(
  p_title text,
  p_body text default '',
  p_assignee_id uuid default null,
  p_due_date timestamptz default null,
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

create function public.update_task(
  target_task_id uuid,
  p_title text,
  p_body text default '',
  p_assignee_id uuid default null,
  p_due_date timestamptz default null,
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

create function public.list_tasks(
  search_query text default '',
  assignee_filter text default 'all',
  status_filter text default 'open',
  priority_filter text default 'all',
  due_filter text default 'all',
  linked_filter text default 'all',
  order_id_filter uuid default null,
  page_number integer default 1,
  page_size integer default 30
)
returns table (
  id uuid,
  title text,
  body text,
  assignee_id uuid,
  assignee_name text,
  due_date timestamptz,
  priority text,
  completed boolean,
  order_id uuid,
  order_number text,
  customer_name text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  completed_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  assignee_value text;
  status_value text;
  priority_value text;
  due_value text;
  linked_value text;
  assignee_uuid uuid;
  safe_page integer;
  safe_size integer;
  today_local date := (now() at time zone 'Europe/Moscow')::date;
begin
  perform public.assert_tasks_read();

  assignee_value := coalesce(nullif(btrim(assignee_filter), ''), 'all');
  status_value := coalesce(nullif(btrim(status_filter), ''), 'open');
  priority_value := coalesce(nullif(btrim(priority_filter), ''), 'all');
  due_value := coalesce(nullif(btrim(due_filter), ''), 'all');
  linked_value := coalesce(nullif(btrim(linked_filter), ''), 'all');

  if status_value not in ('open', 'completed', 'all') then
    raise exception 'Неизвестный статус.';
  end if;
  if priority_value not in ('all', 'low', 'normal', 'high') then
    raise exception 'Неизвестный приоритет.';
  end if;
  if due_value not in ('all', 'overdue', 'today', 'upcoming', 'none') then
    raise exception 'Неизвестный фильтр срока.';
  end if;
  if linked_value not in ('all', 'with', 'none') then
    raise exception 'Неизвестный фильтр заказа.';
  end if;

  if assignee_value not in ('all', 'unassigned') then
    begin
      assignee_uuid := assignee_value::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Некорректный исполнитель.';
    end;
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 30), 1), 100);

  return query
  select
    t.id,
    t.title,
    left(coalesce(t.body, ''), 280) as body,
    t.assignee_id,
    coalesce(a.full_name, a.email, '') as assignee_name,
    t.due_date,
    t.priority,
    t.completed,
    t.order_id,
    coalesce(o.number, '') as order_number,
    coalesce(cu.name, '') as customer_name,
    t.created_by,
    coalesce(c.full_name, c.email, '') as created_by_name,
    t.created_at,
    t.completed_at,
    count(*) over() as total_count
  from public.tasks t
  left join public.profiles a on a.id = t.assignee_id
  left join public.profiles c on c.id = t.created_by
  left join public.orders o on o.id = t.order_id
  left join public.customers cu on cu.id = o.customer_id
  where (status_value = 'all' or (status_value = 'open' and not t.completed) or (status_value = 'completed' and t.completed))
    and (priority_value = 'all' or t.priority = priority_value)
    and (
      assignee_value = 'all'
      or (assignee_value = 'unassigned' and t.assignee_id is null)
      or t.assignee_id = assignee_uuid
    )
    and (
      due_value = 'all'
      or (due_value = 'overdue' and t.due_date is not null and t.due_date < now())
      or (
        due_value = 'today'
        and t.due_date is not null
        and (t.due_date at time zone 'Europe/Moscow')::date = today_local
      )
      or (
        due_value = 'upcoming'
        and t.due_date is not null
        and (t.due_date at time zone 'Europe/Moscow')::date > today_local
      )
      or (due_value = 'none' and t.due_date is null)
    )
    and (
      order_id_filter is not null
      or linked_value = 'all'
      or (linked_value = 'with' and t.order_id is not null)
      or (linked_value = 'none' and t.order_id is null)
    )
    and (order_id_filter is null or t.order_id = order_id_filter)
    and (
      btrim(coalesce(search_query, '')) = ''
      or t.title ilike term escape '\'
      or t.body ilike term escape '\'
      or o.number ilike term escape '\'
    )
  order by t.completed asc, t.due_date asc nulls last, t.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.create_task(text, text, uuid, timestamptz, text, uuid) from public, anon;
revoke all on function public.update_task(uuid, text, text, uuid, timestamptz, text) from public, anon;
revoke all on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) from public, anon;

grant execute on function public.create_task(text, text, uuid, timestamptz, text, uuid) to authenticated;
grant execute on function public.update_task(uuid, text, text, uuid, timestamptz, text) to authenticated;
grant execute on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [37/73 | was 55/151] 20260829330000_order_part_lines.sql
-- -----------------------------------------------------------------------------

-- Запчасти заказа: свои количество и цена, возврат на склад при удалении.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_type_check check (
    movement_type in ('receipt', 'repair_consumption', 'repair_return', 'sale', 'inventory_adjustment')
  );

create table if not exists public.order_part_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null default 0 check (unit_price >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_part_lines_unique unique (order_id, item_id)
);

create index if not exists order_part_lines_order_idx
  on public.order_part_lines (order_id, created_at);

drop trigger if exists order_part_lines_set_updated_at on public.order_part_lines;
create trigger order_part_lines_set_updated_at
  before update on public.order_part_lines
  for each row execute procedure public.set_updated_at();

alter table public.order_part_lines enable row level security;

drop policy if exists order_part_lines_select on public.order_part_lines;
create policy order_part_lines_select
  on public.order_part_lines
  for select
  to authenticated
  using (public.has_permission('orders:read') or public.can_read_inventory());

insert into public.order_part_lines (order_id, item_id, quantity, unit_price, created_by, created_at)
select
  m.reference_id,
  m.item_id,
  sum(-m.quantity),
  coalesce(round((sum(-m.quantity * m.unit_price) / nullif(sum(-m.quantity), 0))::numeric, 2), 0),
  (array_agg(m.created_by order by m.created_at))[1],
  min(m.created_at)
from public.inventory_movements m
where m.reference_type = 'order'
  and m.movement_type = 'repair_consumption'
  and exists (select 1 from public.orders o where o.id = m.reference_id)
  and not exists (
    select 1
    from public.order_part_lines l
    where l.order_id = m.reference_id and l.item_id = m.item_id
  )
group by m.reference_id, m.item_id
having sum(-m.quantity) > 0;

create or replace function public.return_inventory_from_order(
  target_order_id uuid,
  target_item_id uuid,
  return_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining numeric;
  rec record;
  take numeric;
begin
  if return_quantity is null or return_quantity <= 0 then
    raise exception 'Количество возврата должно быть больше нуля.';
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  remaining := return_quantity;

  for rec in
    select
      m.batch_id,
      -sum(m.quantity) as net_qty
    from public.inventory_movements m
    where m.reference_type = 'order'
      and m.reference_id = target_order_id
      and m.item_id = target_item_id
      and m.movement_type in ('repair_consumption', 'repair_return')
    group by m.batch_id
    having -sum(m.quantity) > 0
    order by max(m.created_at) desc, m.batch_id desc
  loop
    exit when remaining <= 0;
    take := least(rec.net_qty, remaining);

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    select
      target_item_id,
      rec.batch_id,
      take,
      b.purchase_price,
      'repair_return',
      'order',
      target_order_id,
      auth.uid()
    from public.inventory_batches b
    where b.id = rec.batch_id;

    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    raise exception 'Нельзя вернуть больше, чем списано в заказ.';
  end if;
end;
$$;

drop function if exists public.consume_inventory_for_order(uuid, uuid, numeric);

create or replace function public.consume_inventory_for_order(
  target_order_id uuid,
  target_item_id uuid,
  consume_quantity numeric,
  line_unit_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  next_price numeric;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания в ремонт.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  next_price := line_unit_price;
  if next_price is null then
    select repair_price into next_price
    from public.inventory_items
    where id = target_item_id;
  end if;

  if next_price is null or next_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  result := public.consume_inventory_fifo(
    target_item_id,
    consume_quantity,
    'repair_consumption',
    'order',
    target_order_id
  );

  insert into public.order_part_lines (order_id, item_id, quantity, unit_price, created_by)
  values (target_order_id, target_item_id, consume_quantity, next_price, auth.uid())
  on conflict (order_id, item_id) do update
    set quantity = public.order_part_lines.quantity + excluded.quantity;

  perform public.record_audit(
    'inventory.consumed_repair',
    'order',
    target_order_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity', consume_quantity, 'unit_price', next_price)
  );

  return result;
end;
$$;

create or replace function public.set_order_part_line(
  target_line_id uuid,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
  delta numeric;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  delta := line_quantity - current_row.quantity;

  if delta > 0 then
    perform public.consume_inventory_fifo(
      current_row.item_id,
      delta,
      'repair_consumption',
      'order',
      current_row.order_id
    );
  elsif delta < 0 then
    perform public.return_inventory_from_order(current_row.order_id, current_row.item_id, -delta);
  end if;

  update public.order_part_lines
  set quantity = line_quantity,
      unit_price = line_unit_price
  where id = target_line_id;

  perform public.record_audit(
    'inventory.order_part_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'item_id', current_row.item_id,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;

create or replace function public.remove_order_part_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для удаления запчасти из заказа.';
  end if;

  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  perform public.return_inventory_from_order(
    current_row.order_id,
    current_row.item_id,
    current_row.quantity
  );

  delete from public.order_part_lines
  where id = target_line_id;

  perform public.record_audit(
    'inventory.returned_repair',
    'order',
    current_row.order_id::text,
    jsonb_build_object('item_id', current_row.item_id, 'quantity', current_row.quantity)
  );
end;
$$;

create or replace function public.get_order_inventory_usage(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('orders:read')
    or public.can_read_inventory()
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        l.id,
        l.item_id,
        i.name as item_name,
        i.code as item_code,
        i.article as item_article,
        i.barcode as item_barcode,
        coalesce(u.name, '') as unit_name,
        l.quantity,
        l.unit_price,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'receipt_date', b.receipt_date,
            'supplier', b.supplier,
            'quantity', b.net_qty
          ) order by b.last_at desc)
          from (
            select
              bt.receipt_date,
              bt.supplier,
              -sum(m.quantity) as net_qty,
              max(m.created_at) as last_at
            from public.inventory_movements m
            join public.inventory_batches bt on bt.id = m.batch_id
            where m.reference_type = 'order'
              and m.reference_id = l.order_id
              and m.item_id = l.item_id
              and m.movement_type in ('repair_consumption', 'repair_return')
            group by bt.id, bt.receipt_date, bt.supplier
            having -sum(m.quantity) > 0
          ) b
        ), '[]'::jsonb) as batches,
        coalesce(p.full_name, '') as actor_name,
        l.created_at
      from public.order_part_lines l
      join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      left join public.profiles p on p.id = l.created_by
      where l.order_id = target_order_id
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.write_order_journal_on_parts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.reference_type <> 'order'
     or new.movement_type not in ('repair_consumption', 'repair_return') then
    return new;
  end if;

  select name into item_name from public.inventory_items where id = new.item_id;

  if new.movement_type = 'repair_return' then
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      new.reference_id,
      'parts_returned',
      auth.uid(),
      'Возвращено на склад: ' || coalesce(item_name, 'позиция') || ' × ' || trim(to_char(abs(new.quantity), '999999990.999')),
      jsonb_build_object(
        'item_id', new.item_id,
        'quantity', abs(new.quantity),
        'movement_id', new.id
      )
    );
  else
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      new.reference_id,
      'parts_consumed',
      auth.uid(),
      'Списано: ' || coalesce(item_name, 'позиция') || ' × ' || trim(to_char(abs(new.quantity), '999999990.999')),
      jsonb_build_object(
        'item_id', new.item_id,
        'quantity', abs(new.quantity),
        'movement_id', new.id
      )
    );
  end if;

  return new;
end;
$$;

create or replace function public.build_document_context(
  p_source_type text,
  p_source_id uuid,
  p_document_number text default '',
  p_issued_at text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  doc_values jsonb := public.empty_document_values();
  parts jsonb := '[]'::jsonb;
  lines jsonb := '[]'::jsonb;
  first_part jsonb;
  first_line jsonb;
begin
  doc_values := doc_values || jsonb_build_object(
    'document.number', coalesce(p_document_number, ''),
    'document.issuedAt', coalesce(p_issued_at, '')
  );

  if p_source_type = 'order' then
    if not public.has_permission('orders:read') then
      raise exception 'Недостаточно прав для данных заказа.';
    end if;

    select doc_values || jsonb_build_object(
      'order.number', o.number,
      'order.createdAt', to_char(o.created_at, 'DD.MM.YYYY'),
      'order.status', coalesce(st.name, ''),
      'order.claimedMalfunction', o.claimed_malfunction,
      'order.completeness', o.completeness,
      'order.externalCondition', o.external_condition,
      'order.deadline', coalesce(to_char(o.deadline, 'DD.MM.YYYY'), ''),
      'order.responsible', coalesce(resp.full_name, ''),
      'customer.name', coalesce(c.name, ''),
      'customer.phone', coalesce(c.phone, ''),
      'customer.email', coalesce(c.email, ''),
      'customer.inn', coalesce(c.inn, ''),
      'customer.city', coalesce(c.city, ''),
      'customer.contactName', coalesce(c.contact_name, ''),
      'device.serialNumber', coalesce(o.serial_number, ''),
      'device.model', coalesce(model.name, ''),
      'device.brand', coalesce(brand.name, ''),
      'device.group', coalesce(grp.name, ''),
      'device.label', trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), o.serial_number))
    )
    into doc_values
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join public.devices d on d.id = o.device_id
    left join public.reference_items st on st.id = o.status_id
    left join public.reference_items grp on grp.id = d.group_id
    left join public.reference_items brand on brand.id = d.brand_id
    left join public.reference_items model on model.id = d.model_id
    left join public.profiles resp on resp.id = o.responsible_id
    where o.id = p_source_id;

    if doc_values is null then
      raise exception 'Заказ не найден.';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'part.name', x.item_name,
      'part.code', x.item_code,
      'part.article', x.item_article,
      'part.quantity', x.quantity,
      'part.unitName', x.unit_name,
      'part.price', x.unit_price
    ) order by x.created_at), '[]'::jsonb)
    into parts
    from (
      select
        i.name as item_name,
        i.code as item_code,
        i.article as item_article,
        trim(to_char(l.quantity, '999999990.999')) as quantity,
        coalesce(u.name, '') as unit_name,
        trim(to_char(l.unit_price, '999999990.99')) as unit_price,
        l.created_at
      from public.order_part_lines l
      join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      where l.order_id = p_source_id
    ) x;

    first_part := parts -> 0;
    if first_part is not null then
      doc_values := doc_values || first_part;
    end if;
  elsif p_source_type = 'sale' then
    if not public.has_permission('sales:read') then
      raise exception 'Недостаточно прав для данных продажи.';
    end if;

    select doc_values || jsonb_build_object(
      'sale.invoiceNumber', s.invoice_number,
      'sale.date', to_char(s.sale_date, 'DD.MM.YYYY'),
      'sale.total', trim(to_char(s.total, '999999990.99')),
      'sale.customerName', coalesce(c.name, ''),
      'sale.status', case s.status
        when 'draft' then 'Черновик'
        when 'confirmed' then 'Подтверждена'
        when 'cancelled' then 'Отменена'
        else s.status
      end,
      'customer.name', coalesce(c.name, ''),
      'customer.phone', coalesce(c.phone, ''),
      'customer.email', coalesce(c.email, ''),
      'customer.inn', coalesce(c.inn, ''),
      'customer.city', coalesce(c.city, ''),
      'customer.contactName', coalesce(c.contact_name, '')
    )
    into doc_values
    from public.sales s
    left join public.customers c on c.id = s.customer_id
    where s.id = p_source_id;

    if doc_values is null then
      raise exception 'Продажа не найдена.';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'line.name', i.name,
      'line.code', i.code,
      'line.article', i.article,
      'line.quantity', trim(to_char(l.quantity, '999999990.999')),
      'line.unitName', coalesce(u.name, ''),
      'line.price', trim(to_char(l.unit_price, '999999990.99')),
      'line.amount', trim(to_char(l.amount, '999999990.99'))
    ) order by l.sort_order, l.created_at), '[]'::jsonb)
    into lines
    from public.sale_lines l
    join public.inventory_items i on i.id = l.item_id
    left join public.reference_items u on u.id = i.unit_id
    where l.sale_id = p_source_id;

    first_line := lines -> 0;
    if first_line is not null then
      doc_values := doc_values || first_line;
    end if;
  elsif p_source_type = 'item' then
    if not (
      public.can_read_inventory()
      or public.has_permission('orders:read')
      or public.has_permission('sales:read')
    ) then
      raise exception 'Недостаточно прав для данных номенклатуры.';
    end if;

    select doc_values || jsonb_build_object(
      'item.name', i.name,
      'item.code', i.code,
      'item.article', i.article,
      'item.barcode', i.barcode,
      'part.name', i.name,
      'part.code', i.code,
      'part.article', i.article
    )
    into doc_values
    from public.inventory_items i
    where i.id = p_source_id;

    if doc_values is null then
      raise exception 'Позиция не найдена.';
    end if;
  elsif p_source_type <> 'none' then
    raise exception 'Неизвестный источник документа.';
  end if;

  return jsonb_build_object(
    'values', doc_values,
    'parts', coalesce(parts, '[]'::jsonb),
    'lines', coalesce(lines, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.return_inventory_from_order(uuid, uuid, numeric) from public, anon;
revoke all on function public.consume_inventory_for_order(uuid, uuid, numeric, numeric) from public, anon;
revoke all on function public.set_order_part_line(uuid, numeric, numeric) from public, anon;
revoke all on function public.remove_order_part_line(uuid) from public, anon;

grant execute on function public.consume_inventory_for_order(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.set_order_part_line(uuid, numeric, numeric) to authenticated;
grant execute on function public.remove_order_part_line(uuid) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [38/73 | was 56/151] 20260829340000_order_services.sql
-- -----------------------------------------------------------------------------

create table public.service_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  unit_price numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_templates_name_present check (btrim(name) <> ''),
  constraint service_templates_price_nonneg check (unit_price >= 0)
);

create unique index service_templates_name_unique
  on public.service_templates (lower(btrim(name)));

create trigger service_templates_set_updated_at
  before update on public.service_templates
  for each row execute procedure public.set_updated_at();

create table public.order_service_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  template_id uuid references public.service_templates (id) on delete set null,
  name text not null,
  quantity numeric(14, 3) not null default 1,
  unit_price numeric(14, 2) not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_service_lines_name_present check (btrim(name) <> ''),
  constraint order_service_lines_qty_positive check (quantity > 0),
  constraint order_service_lines_price_nonneg check (unit_price >= 0)
);

create unique index order_service_lines_order_template_unique
  on public.order_service_lines (order_id, template_id)
  where template_id is not null;

create index order_service_lines_order_id_idx on public.order_service_lines (order_id);

create trigger order_service_lines_set_updated_at
  before update on public.order_service_lines
  for each row execute procedure public.set_updated_at();

alter table public.service_templates enable row level security;
alter table public.order_service_lines enable row level security;

revoke all on table public.service_templates from public, anon, authenticated;
revoke all on table public.order_service_lines from public, anon, authenticated;

create or replace function public.search_service_templates(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  active_only boolean default false
)
returns table (
  id uuid,
  name text,
  description text,
  unit_price numeric,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text := btrim(coalesce(search_query, ''));
  safe_page integer := greatest(coalesce(page_number, 1), 1);
  safe_size integer := least(greatest(coalesce(page_size, 20), 1), 100);
begin
  if not (
    public.has_permission('settings:read')
    or public.has_permission('orders:read')
  ) then
    raise exception 'Недостаточно прав для просмотра услуг.';
  end if;

  return query
  with filtered as (
    select t.*
    from public.service_templates t
    where (not active_only or t.is_active)
      and (
        term = ''
        or t.name ilike '%' || term || '%'
        or t.description ilike '%' || term || '%'
      )
  )
  select
    f.id,
    f.name,
    f.description,
    f.unit_price,
    f.is_active,
    f.created_at,
    f.updated_at,
    (select count(*) from filtered) as total_count
  from filtered f
  order by f.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.create_service_template(
  template_name text,
  template_description text default '',
  template_unit_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not (
    public.has_permission('settings:update')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для создания услуги.';
  end if;

  if btrim(coalesce(template_name, '')) = '' then
    raise exception 'Укажите наименование.';
  end if;

  if coalesce(template_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if exists (
    select 1
    from public.service_templates
    where lower(btrim(name)) = lower(btrim(template_name))
  ) then
    raise exception 'Такое наименование уже в справочнике';
  end if;

  insert into public.service_templates (name, description, unit_price, created_by)
  values (
    btrim(template_name),
    btrim(coalesce(template_description, '')),
    coalesce(template_unit_price, 0),
    auth.uid()
  )
  returning id into new_id;

  perform public.write_audit_event(
    auth.uid(),
    'services.template_created',
    'service_template',
    new_id::text,
    jsonb_build_object('name', btrim(template_name))
  );

  return new_id;
end;
$$;

create or replace function public.update_service_template(
  target_id uuid,
  template_name text,
  template_description text default '',
  template_unit_price numeric default 0,
  template_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения услуги.';
  end if;

  if btrim(coalesce(template_name, '')) = '' then
    raise exception 'Укажите наименование.';
  end if;

  if coalesce(template_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if exists (
    select 1
    from public.service_templates
    where lower(btrim(name)) = lower(btrim(template_name))
      and id <> target_id
  ) then
    raise exception 'Такое наименование уже в справочнике';
  end if;

  update public.service_templates
  set
    name = btrim(template_name),
    description = btrim(coalesce(template_description, '')),
    unit_price = coalesce(template_unit_price, 0),
    is_active = coalesce(template_is_active, true)
  where id = target_id;

  if not found then
    raise exception 'Услуга не найдена.';
  end if;

  perform public.write_audit_event(
    auth.uid(),
    'services.template_updated',
    'service_template',
    target_id::text,
    jsonb_build_object('name', btrim(template_name))
  );
end;
$$;

create or replace function public.delete_service_template(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  template_name text;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для удаления услуги.';
  end if;

  if exists (select 1 from public.order_service_lines where template_id = target_id) then
    raise exception 'Услуга используется в заказах. Удаление недоступно.';
  end if;

  select name into template_name from public.service_templates where id = target_id;
  if template_name is null then
    raise exception 'Услуга не найдена.';
  end if;

  delete from public.service_templates where id = target_id;

  perform public.write_audit_event(
    auth.uid(),
    'services.template_deleted',
    'service_template',
    target_id::text,
    jsonb_build_object('name', template_name)
  );
end;
$$;

create or replace function public.get_order_service_lines(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав для состава заказа.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'order_id', l.order_id,
      'template_id', l.template_id,
      'name', l.name,
      'description', coalesce(t.description, ''),
      'quantity', l.quantity,
      'unit_price', l.unit_price,
      'created_at', l.created_at
    ) order by l.created_at)
    from public.order_service_lines l
    left join public.service_templates t on t.id = l.template_id
    where l.order_id = target_order_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.add_order_service_line(
  target_order_id uuid,
  target_template_id uuid,
  line_quantity numeric,
  line_unit_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  template_name text;
  line_id uuid;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  select name into template_name
  from public.service_templates
  where id = target_template_id and is_active;

  if template_name is null then
    raise exception 'Услуга не найдена.';
  end if;

  insert into public.order_service_lines (
    order_id, template_id, name, quantity, unit_price, created_by
  )
  values (
    target_order_id,
    target_template_id,
    template_name,
    line_quantity,
    line_unit_price,
    auth.uid()
  )
  on conflict (order_id, template_id) where template_id is not null
  do update set
    quantity = public.order_service_lines.quantity + excluded.quantity,
    unit_price = excluded.unit_price
  returning id into line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'service_added',
    auth.uid(),
    'Добавлена услуга: ' || template_name || ' × ' || trim(to_char(line_quantity, '999999990.999')),
    jsonb_build_object(
      'line_id', line_id,
      'template_id', target_template_id,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_added',
    'order',
    target_order_id::text,
    jsonb_build_object('name', template_name, 'quantity', line_quantity)
  );

  return line_id;
end;
$$;

create or replace function public.set_order_service_line(
  target_line_id uuid,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order uuid;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.order_service_lines
  set quantity = line_quantity, unit_price = line_unit_price
  where id = target_line_id
  returning order_id into target_order;

  if target_order is null then
    raise exception 'Строка услуги не найдена.';
  end if;

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_updated',
    'order',
    target_order::text,
    jsonb_build_object('line_id', target_line_id, 'quantity', line_quantity, 'unit_price', line_unit_price)
  );
end;
$$;

create or replace function public.remove_order_service_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order uuid;
  line_name text;
  line_qty numeric;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  select order_id, name, quantity
  into target_order, line_name, line_qty
  from public.order_service_lines
  where id = target_line_id;

  if target_order is null then
    raise exception 'Строка услуги не найдена.';
  end if;

  delete from public.order_service_lines where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order,
    'service_removed',
    auth.uid(),
    'Удалена услуга: ' || coalesce(line_name, 'услуга') || ' × ' || trim(to_char(coalesce(line_qty, 0), '999999990.999')),
    jsonb_build_object('line_id', target_line_id, 'name', line_name)
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_removed',
    'order',
    target_order::text,
    jsonb_build_object('name', line_name)
  );
end;
$$;

revoke all on function public.search_service_templates(text, integer, integer, boolean) from public, anon;
revoke all on function public.create_service_template(text, text, numeric) from public, anon;
revoke all on function public.update_service_template(uuid, text, text, numeric, boolean) from public, anon;
revoke all on function public.delete_service_template(uuid) from public, anon;
revoke all on function public.get_order_service_lines(uuid) from public, anon;
revoke all on function public.add_order_service_line(uuid, uuid, numeric, numeric) from public, anon;
revoke all on function public.set_order_service_line(uuid, numeric, numeric) from public, anon;
revoke all on function public.remove_order_service_line(uuid) from public, anon;

grant execute on function public.search_service_templates(text, integer, integer, boolean) to authenticated;
grant execute on function public.create_service_template(text, text, numeric) to authenticated;
grant execute on function public.update_service_template(uuid, text, text, numeric, boolean) to authenticated;
grant execute on function public.delete_service_template(uuid) to authenticated;
grant execute on function public.get_order_service_lines(uuid) to authenticated;
grant execute on function public.add_order_service_line(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.set_order_service_line(uuid, numeric, numeric) to authenticated;
grant execute on function public.remove_order_service_line(uuid) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [39/73 | was 57/151] 20260829350000_fix_update_order_column_conflict.sql
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- [40/73 | was 58/151] 20260829360000_receipt_supplier_customer.sql
-- -----------------------------------------------------------------------------

-- Приход связан с контактом-поставщиком, чтобы в карточке организации были поставки.

alter table public.inventory_receipts
  add column if not exists supplier_id uuid references public.customers (id) on delete set null;

create index if not exists inventory_receipts_supplier_id_idx
  on public.inventory_receipts (supplier_id, created_at desc)
  where supplier_id is not null;

update public.inventory_receipts as receipt
set supplier_id = match.id
from (
  select distinct on (lower(btrim(c.name)))
    c.id,
    lower(btrim(c.name)) as name_key
  from public.customers c
  order by lower(btrim(c.name)), c.created_at
) as match
where receipt.supplier_id is null
  and lower(btrim(receipt.supplier)) = match.name_key;

drop function if exists public.receive_inventory(text, date, text, jsonb);

create or replace function public.receive_inventory(
  supplier_name text,
  doc_receipt_date date,
  doc_notes text,
  lines jsonb,
  supplier_customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_id uuid;
  line record;
  batch_id uuid;
  line_count integer := 0;
  resolved_name text;
  resolved_supplier_id uuid;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для прихода.';
  end if;

  resolved_supplier_id := supplier_customer_id;
  resolved_name := btrim(coalesce(supplier_name, ''));

  if resolved_supplier_id is not null then
    select c.name into resolved_name
    from public.customers c
    where c.id = resolved_supplier_id;

    if resolved_name is null then
      raise exception 'Поставщик не найден.';
    end if;
  elsif resolved_name = '' then
    raise exception 'Укажите поставщика.';
  else
    select c.id
    into resolved_supplier_id
    from public.customers c
    where lower(btrim(c.name)) = lower(resolved_name)
    order by c.created_at
    limit 1;
  end if;

  if doc_receipt_date is null then
    raise exception 'Укажите дату прихода.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(lines, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  insert into public.inventory_receipts (supplier, supplier_id, receipt_date, notes, created_by)
  values (resolved_name, resolved_supplier_id, doc_receipt_date, btrim(coalesce(doc_notes, '')), auth.uid())
  returning id into receipt_id;

  for line in
    select *
    from jsonb_to_recordset(lines) as x(
      item_id uuid,
      quantity numeric,
      purchase_price numeric
    )
  loop
    line_count := line_count + 1;

    if line.item_id is null then
      raise exception 'В строке прихода не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция прихода не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 then
      raise exception 'Количество в приходе должно быть больше нуля.';
    end if;

    if line.purchase_price is null or line.purchase_price < 0 then
      raise exception 'Цена закупки не может быть отрицательной.';
    end if;

    perform pg_advisory_xact_lock(871001, hashtext(line.item_id::text));

    insert into public.inventory_batches (
      item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
    )
    values (
      line.item_id,
      receipt_id,
      resolved_name,
      doc_receipt_date,
      line.purchase_price,
      line.quantity,
      0
    )
    returning id into batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      line.item_id,
      batch_id,
      line.quantity,
      line.purchase_price,
      'receipt',
      'receipt',
      receipt_id,
      auth.uid()
    );
  end loop;

  if line_count = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  perform public.record_audit(
    'inventory.received',
    'inventory_receipt',
    receipt_id::text,
    jsonb_build_object('supplier', resolved_name, 'lines', line_count)
  );

  return receipt_id;
end;
$$;

create or replace function public.get_customer_card(target_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
  customer_name text;
  receipts jsonb := '[]'::jsonb;
begin
  if not (public.has_permission('customers:read') or public.has_permission('orders:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'kind', c.kind,
    'name', c.name,
    'inn', c.inn,
    'kpp', c.kpp,
    'ogrn', c.ogrn,
    'phone', c.phone,
    'email', c.email,
    'city', c.city,
    'contact_name', c.contact_name,
    'notes', c.notes,
    'is_active', c.is_active,
    'created_at', c.created_at,
    'updated_at', c.updated_at
  ),
    c.name
  into payload, customer_name
  from public.customers c
  where c.id = target_customer_id;

  if payload is null then
    return null;
  end if;

  if public.has_permission('inventory:read') or public.has_permission('inventory:receive') then
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'id', r.id,
        'supplier', r.supplier,
        'receipt_date', r.receipt_date,
        'notes', r.notes,
        'created_at', r.created_at,
        'actor_name', coalesce(p.full_name, ''),
        'line_count', r.line_count,
        'total_quantity', r.total_quantity
      ) order by r.created_at desc),
      '[]'::jsonb
    )
    into receipts
    from (
      select
        rec.id,
        rec.supplier,
        rec.receipt_date,
        rec.notes,
        rec.created_at,
        rec.created_by,
        count(m.id) as line_count,
        coalesce(sum(m.quantity), 0) as total_quantity
      from public.inventory_receipts rec
      left join public.inventory_movements m
        on m.reference_type = 'receipt' and m.reference_id = rec.id
      where rec.supplier_id = target_customer_id
         or (
           rec.supplier_id is null
           and lower(btrim(rec.supplier)) = lower(btrim(customer_name))
         )
      group by rec.id
      order by rec.created_at desc
      limit 50
    ) r
    left join public.profiles p on p.id = r.created_by;
  end if;

  return jsonb_build_object(
    'customer', payload,
    'devices', coalesce(
      (
        select jsonb_agg(item order by item ->> 'serial_number')
        from (
          select distinct on (d.id) jsonb_build_object(
            'id', d.id,
            'serial_number', d.serial_number,
            'label', coalesce(li.label, d.serial_number),
            'group_name', coalesce(li.group_name, ''),
            'brand_name', coalesce(li.brand_name, ''),
            'model_name', coalesce(li.model_name, '')
          ) as item
          from public.devices d
          left join public.device_list_items li on li.id = d.id
          where d.customer_id = target_customer_id
            or exists (
              select 1 from public.orders o
              where o.customer_id = target_customer_id and o.device_id = d.id
            )
          order by d.id, d.serial_number
        ) devices
      ),
      '[]'::jsonb
    ),
    'orders', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', o.id,
          'number', o.number,
          'serial_number', o.serial_number,
          'device_label', o.device_label,
          'status_name', o.status_name,
          'status_code', o.status_code,
          'created_at', o.created_at
        ) order by o.created_at desc)
        from (
          select *
          from public.order_list_items
          where customer_id = target_customer_id
          order by created_at desc
          limit 50
        ) o
      ),
      '[]'::jsonb
    ),
    'receipts', coalesce(receipts, '[]'::jsonb),
    'history', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'action', e.action,
          'actor_name', coalesce(p.full_name, p.email, ''),
          'metadata', e.metadata,
          'created_at', e.created_at
        ) order by e.created_at desc)
        from (
          select *
          from public.audit_events
          where entity_type = 'customer' and entity_id = target_customer_id::text
          order by created_at desc
          limit 50
        ) e
        left join public.profiles p on p.id = e.actor_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.receive_inventory(text, date, text, jsonb, uuid) from public;
grant execute on function public.receive_inventory(text, date, text, jsonb, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [41/73 | was 59/151] 20260829370000_delete_inventory_receipt.sql
-- -----------------------------------------------------------------------------

-- Скрытие прихода (без изменения остатка) и полная отмена (сторнирование партий).

alter table public.inventory_receipts
  add column if not exists hidden_at timestamptz,
  add column if not exists reversed_at timestamptz;

create index if not exists inventory_receipts_visible_idx
  on public.inventory_receipts (created_at desc)
  where hidden_at is null;

create or replace function public.delete_inventory_receipt(
  target_receipt_id uuid,
  delete_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_receipts%rowtype;
  movement_row record;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления прихода.';
  end if;

  select *
    into current_row
  from public.inventory_receipts
  where id = target_receipt_id
  for update;

  if not found then
    raise exception 'Приход не найден.';
  end if;

  if current_row.reversed_at is not null then
    raise exception 'Приход уже отменён.';
  end if;

  if delete_mode = 'hide' then
    if current_row.hidden_at is not null then
      raise exception 'Приход уже скрыт.';
    end if;

    update public.inventory_receipts
    set hidden_at = now()
    where id = target_receipt_id;

    perform public.record_audit(
      'inventory.receipt_hidden',
      'inventory_receipt',
      target_receipt_id::text,
      jsonb_build_object('supplier', current_row.supplier)
    );

    return;
  end if;

  if delete_mode <> 'reverse' then
    raise exception 'Неверный режим удаления прихода.';
  end if;

  for movement_row in
    select
      m.id,
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price,
      b.remaining_quantity
    from public.inventory_movements m
    join public.inventory_batches b on b.id = m.batch_id
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'receipt'
    order by m.created_at, m.id
  loop
    if movement_row.remaining_quantity < movement_row.quantity then
      raise exception 'Нельзя отменить приход: часть позиций уже списана.';
    end if;
  end loop;

  for movement_row in
    select
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price
    from public.inventory_movements m
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'receipt'
    order by m.created_at, m.id
  loop
    perform pg_advisory_xact_lock(871001, hashtext(movement_row.item_id::text));

    insert into public.inventory_movements (
      item_id,
      batch_id,
      quantity,
      unit_price,
      movement_type,
      reference_type,
      reference_id,
      created_by
    )
    values (
      movement_row.item_id,
      movement_row.batch_id,
      -movement_row.quantity,
      movement_row.unit_price,
      'inventory_adjustment',
      'receipt',
      target_receipt_id,
      auth.uid()
    );
  end loop;

  update public.inventory_receipts
  set hidden_at = coalesce(hidden_at, now()),
      reversed_at = now()
  where id = target_receipt_id;

  perform public.record_audit(
    'inventory.receipt_reversed',
    'inventory_receipt',
    target_receipt_id::text,
    jsonb_build_object('supplier', current_row.supplier)
  );
end;
$$;

create or replace function public.list_inventory_receipts(
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  supplier text,
  receipt_date date,
  notes text,
  created_at timestamptz,
  actor_name text,
  line_count bigint,
  total_quantity numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_page integer;
  safe_size integer;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра приходов.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    r.id,
    r.supplier,
    r.receipt_date,
    r.notes,
    r.created_at,
    coalesce(p.full_name, '') as actor_name,
    count(m.id) as line_count,
    coalesce(sum(m.quantity), 0) as total_quantity,
    count(*) over() as total_count
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  left join public.inventory_movements m
    on m.reference_type = 'receipt'
   and m.reference_id = r.id
   and m.movement_type = 'receipt'
  where r.hidden_at is null
  group by r.id, r.supplier, r.receipt_date, r.notes, r.created_at, p.full_name
  order by r.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_inventory_receipt(target_receipt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  header jsonb;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра прихода.';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'supplier', r.supplier,
    'receipt_date', r.receipt_date,
    'notes', r.notes,
    'created_at', r.created_at,
    'actor_name', coalesce(p.full_name, '')
  )
  into header
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  where r.id = target_receipt_id
    and r.hidden_at is null;

  if header is null then
    raise exception 'Приход не найден.';
  end if;

  return header || jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.created_at)
      from (
        select
          m.id,
          m.item_id,
          i.name as item_name,
          i.code as item_code,
          i.article as item_article,
          m.quantity,
          m.unit_price,
          m.batch_id,
          b.remaining_quantity,
          m.created_at
        from public.inventory_movements m
        join public.inventory_items i on i.id = m.item_id
        join public.inventory_batches b on b.id = m.batch_id
        where m.reference_type = 'receipt'
          and m.reference_id = target_receipt_id
          and m.movement_type = 'receipt'
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_customer_card(target_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
  customer_name text;
  receipts jsonb := '[]'::jsonb;
begin
  if not (public.has_permission('customers:read') or public.has_permission('orders:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'kind', c.kind,
    'name', c.name,
    'inn', c.inn,
    'kpp', c.kpp,
    'ogrn', c.ogrn,
    'phone', c.phone,
    'email', c.email,
    'city', c.city,
    'contact_name', c.contact_name,
    'notes', c.notes,
    'is_active', c.is_active,
    'created_at', c.created_at,
    'updated_at', c.updated_at
  ),
    c.name
  into payload, customer_name
  from public.customers c
  where c.id = target_customer_id;

  if payload is null then
    return null;
  end if;

  if public.has_permission('inventory:read') or public.has_permission('inventory:receive') then
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'id', r.id,
        'supplier', r.supplier,
        'receipt_date', r.receipt_date,
        'notes', r.notes,
        'created_at', r.created_at,
        'actor_name', coalesce(p.full_name, ''),
        'line_count', r.line_count,
        'total_quantity', r.total_quantity
      ) order by r.created_at desc),
      '[]'::jsonb
    )
    into receipts
    from (
      select
        rec.id,
        rec.supplier,
        rec.receipt_date,
        rec.notes,
        rec.created_at,
        rec.created_by,
        count(m.id) as line_count,
        coalesce(sum(m.quantity), 0) as total_quantity
      from public.inventory_receipts rec
      left join public.inventory_movements m
        on m.reference_type = 'receipt'
       and m.reference_id = rec.id
       and m.movement_type = 'receipt'
      where rec.hidden_at is null
        and (
          rec.supplier_id = target_customer_id
          or (
            rec.supplier_id is null
            and lower(btrim(rec.supplier)) = lower(btrim(customer_name))
          )
        )
      group by rec.id
      order by rec.created_at desc
      limit 50
    ) r
    left join public.profiles p on p.id = r.created_by;
  end if;

  return jsonb_build_object(
    'customer', payload,
    'devices', coalesce(
      (
        select jsonb_agg(item order by item ->> 'serial_number')
        from (
          select distinct on (d.id) jsonb_build_object(
            'id', d.id,
            'serial_number', d.serial_number,
            'label', coalesce(li.label, d.serial_number),
            'group_name', coalesce(li.group_name, ''),
            'brand_name', coalesce(li.brand_name, ''),
            'model_name', coalesce(li.model_name, '')
          ) as item
          from public.devices d
          left join public.device_list_items li on li.id = d.id
          where d.customer_id = target_customer_id
            or exists (
              select 1 from public.orders o
              where o.customer_id = target_customer_id and o.device_id = d.id
            )
          order by d.id, d.serial_number
        ) devices
      ),
      '[]'::jsonb
    ),
    'orders', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', o.id,
          'number', o.number,
          'serial_number', o.serial_number,
          'device_label', o.device_label,
          'status_name', o.status_name,
          'status_code', o.status_code,
          'created_at', o.created_at
        ) order by o.created_at desc)
        from (
          select *
          from public.order_list_items
          where customer_id = target_customer_id
          order by created_at desc
          limit 50
        ) o
      ),
      '[]'::jsonb
    ),
    'receipts', coalesce(receipts, '[]'::jsonb),
    'history', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'action', e.action,
          'actor_name', coalesce(p.full_name, p.email, ''),
          'metadata', e.metadata,
          'created_at', e.created_at
        ) order by e.created_at desc)
        from (
          select *
          from public.audit_events
          where entity_type = 'customer' and entity_id = target_customer_id::text
          order by created_at desc
          limit 50
        ) e
        left join public.profiles p on p.id = e.actor_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.delete_inventory_receipt(uuid, text) from public, anon;
grant execute on function public.delete_inventory_receipt(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [42/73 | was 60/151] 20260829380000_supplier_customer_links.sql
-- -----------------------------------------------------------------------------

-- Ссылка на карточку контакта-поставщика из приходов и партий.

drop function if exists public.list_inventory_receipts(integer, integer);

create or replace function public.list_inventory_receipts(
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  supplier text,
  supplier_id uuid,
  receipt_date date,
  notes text,
  created_at timestamptz,
  actor_name text,
  line_count bigint,
  total_quantity numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_page integer;
  safe_size integer;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра приходов.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    r.id,
    r.supplier,
    r.supplier_id,
    r.receipt_date,
    r.notes,
    r.created_at,
    coalesce(p.full_name, '') as actor_name,
    count(m.id) as line_count,
    coalesce(sum(m.quantity), 0) as total_quantity,
    count(*) over() as total_count
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  left join public.inventory_movements m
    on m.reference_type = 'receipt'
   and m.reference_id = r.id
   and m.movement_type = 'receipt'
  where r.hidden_at is null
  group by r.id, r.supplier, r.supplier_id, r.receipt_date, r.notes, r.created_at, p.full_name
  order by r.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_inventory_receipt(target_receipt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  header jsonb;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра прихода.';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'supplier', r.supplier,
    'supplier_id', r.supplier_id,
    'receipt_date', r.receipt_date,
    'notes', r.notes,
    'created_at', r.created_at,
    'actor_name', coalesce(p.full_name, '')
  )
  into header
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  where r.id = target_receipt_id
    and r.hidden_at is null;

  if header is null then
    raise exception 'Приход не найден.';
  end if;

  return header || jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.created_at)
      from (
        select
          m.id,
          m.item_id,
          i.name as item_name,
          i.code as item_code,
          i.article as item_article,
          m.quantity,
          m.unit_price,
          m.batch_id,
          b.remaining_quantity,
          m.created_at
        from public.inventory_movements m
        join public.inventory_items i on i.id = m.item_id
        join public.inventory_batches b on b.id = m.batch_id
        where m.reference_type = 'receipt'
          and m.reference_id = target_receipt_id
          and m.movement_type = 'receipt'
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'name', i.name,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          rec.supplier_id,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        left join public.inventory_receipts rec on rec.id = bt.receipt_id
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        select
          m.id,
          m.quantity,
          m.unit_price,
          m.movement_type,
          m.reference_type,
          m.reference_id,
          m.created_at,
          m.batch_id,
          bt.receipt_date as batch_receipt_date,
          bt.supplier as batch_supplier,
          coalesce(p.full_name, '') as actor_name,
          case m.reference_type
            when 'order' then 'Заказ ' || coalesce(o.number, '')
            when 'receipt' then 'Приход · ' || coalesce(r.supplier, '')
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа · счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_inventory_receipts(integer, integer) from public;
grant execute on function public.list_inventory_receipts(integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- [43/73 | was 61/151] 20260829390000_audit_page_size_100.sql
-- -----------------------------------------------------------------------------

-- Журнал действий: разрешить до 100 записей на странице, как в остальных списках.

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
  safe_size := least(greatest(coalesce(page_size, 50), 1), 100);

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

-- -----------------------------------------------------------------------------
-- [44/73 | was 62/151] 20260829400000_service_lines_actor_name.sql
-- -----------------------------------------------------------------------------

-- Expose who added each service line (for work composition grouping).

create or replace function public.get_order_service_lines(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав для состава заказа.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'order_id', l.order_id,
      'template_id', l.template_id,
      'name', l.name,
      'description', coalesce(t.description, ''),
      'quantity', l.quantity,
      'unit_price', l.unit_price,
      'actor_name', coalesce(p.full_name, p.email, ''),
      'created_at', l.created_at
    ) order by l.created_at)
    from public.order_service_lines l
    left join public.service_templates t on t.id = l.template_id
    left join public.profiles p on p.id = l.created_by
    where l.order_id = target_order_id
  ), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- [45/73 | was 63/151] 20260829410000_order_consume_allow_shortage.sql
-- -----------------------------------------------------------------------------

-- Allow order write-offs even when warehouse stock is insufficient.
-- Missing qty is covered by a temporary shortage batch (net stock stays correct).

drop function if exists public.consume_inventory_fifo(uuid, numeric, text, text, uuid);

create function public.consume_inventory_fifo(
  target_item_id uuid,
  consume_quantity numeric,
  target_movement_type text,
  target_reference_type text,
  target_reference_id uuid,
  allow_shortage boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  available numeric;
  remaining numeric;
  take numeric;
  batch_row public.inventory_batches%rowtype;
  shortage_batch_id uuid;
  movement_id uuid;
  lines jsonb := '[]'::jsonb;
begin
  if consume_quantity is null or consume_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  perform 1
  from public.inventory_batches
  where item_id = target_item_id
  for update;

  select coalesce(sum(remaining_quantity), 0)
    into available
  from public.inventory_batches
  where item_id = target_item_id;

  if available < consume_quantity and not coalesce(allow_shortage, false) then
    raise exception 'Недостаточно остатка. Доступно: %, запрошено: %.', available, consume_quantity;
  end if;

  remaining := consume_quantity;

  for batch_row in
    select *
    from public.inventory_batches
    where item_id = target_item_id
      and remaining_quantity > 0
    order by receipt_date asc, created_at asc, id asc
    for update
  loop
    exit when remaining <= 0;

    take := least(batch_row.remaining_quantity, remaining);

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      batch_row.id,
      -take,
      batch_row.purchase_price,
      target_movement_type,
      target_reference_type,
      target_reference_id,
      auth.uid()
    )
    returning id into movement_id;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'movement_id', movement_id,
      'batch_id', batch_row.id,
      'quantity', take,
      'unit_price', batch_row.purchase_price,
      'receipt_date', batch_row.receipt_date
    ));

    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    if not coalesce(allow_shortage, false) then
      raise exception 'Недостаточно остатка.';
    end if;

    insert into public.inventory_batches (
      item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
    )
    values (
      target_item_id,
      null,
      'Недостача',
      current_date,
      0,
      remaining,
      remaining
    )
    returning id into shortage_batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      shortage_batch_id,
      -remaining,
      0,
      target_movement_type,
      target_reference_type,
      target_reference_id,
      auth.uid()
    )
    returning id into movement_id;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'movement_id', movement_id,
      'batch_id', shortage_batch_id,
      'quantity', remaining,
      'unit_price', 0,
      'receipt_date', current_date,
      'shortage', true
    ));

    remaining := 0;
  end if;

  return jsonb_build_object(
    'item_id', target_item_id,
    'quantity', consume_quantity,
    'lines', lines
  );
end;
$$;

revoke all on function public.consume_inventory_fifo(uuid, numeric, text, text, uuid, boolean)
  from public, anon;
grant execute on function public.consume_inventory_fifo(uuid, numeric, text, text, uuid, boolean)
  to authenticated;

create or replace function public.consume_inventory_for_order(
  target_order_id uuid,
  target_item_id uuid,
  consume_quantity numeric,
  line_unit_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  next_price numeric;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания в ремонт.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  next_price := line_unit_price;
  if next_price is null then
    select repair_price into next_price
    from public.inventory_items
    where id = target_item_id;
  end if;

  if next_price is null or next_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  result := public.consume_inventory_fifo(
    target_item_id,
    consume_quantity,
    'repair_consumption',
    'order',
    target_order_id,
    true
  );

  insert into public.order_part_lines (order_id, item_id, quantity, unit_price, created_by)
  values (target_order_id, target_item_id, consume_quantity, next_price, auth.uid())
  on conflict (order_id, item_id) do update
    set quantity = public.order_part_lines.quantity + excluded.quantity;

  perform public.record_audit(
    'inventory.consumed_repair',
    'order',
    target_order_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity', consume_quantity, 'unit_price', next_price)
  );

  return result;
end;
$$;

create or replace function public.set_order_part_line(
  target_line_id uuid,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
  delta numeric;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  delta := line_quantity - current_row.quantity;

  if delta > 0 then
    perform public.consume_inventory_fifo(
      current_row.item_id,
      delta,
      'repair_consumption',
      'order',
      current_row.order_id,
      true
    );
  elsif delta < 0 then
    perform public.return_inventory_from_order(current_row.order_id, current_row.item_id, -delta);
  end if;

  update public.order_part_lines
  set quantity = line_quantity,
      unit_price = line_unit_price
  where id = target_line_id;

  perform public.record_audit(
    'inventory.order_part_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'item_id', current_row.item_id,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- [46/73 | was 64/151] 20260829420000_device_brands_under_groups.sql
-- -----------------------------------------------------------------------------

-- Бренды приборов принадлежат группе: Группа → Бренд → Модель → Модификация.

-- Код уникален в рамках родителя (один Olympus в разных группах — разные записи).
alter table public.reference_items
  drop constraint if exists reference_items_set_code_unique;

create unique index if not exists reference_items_set_parent_code_uidx
  on public.reference_items (set_id, parent_id, code)
  where parent_id is not null;

create unique index if not exists reference_items_set_root_code_uidx
  on public.reference_items (set_id, code)
  where parent_id is null;

update public.reference_sets brands
set
  parent_set_id = groups.id,
  description = 'Производители в рамках группы приборов',
  updated_at = now()
from public.reference_sets groups
where brands.code = 'device_brands'
  and groups.code = 'device_groups'
  and brands.parent_set_id is distinct from groups.id;

-- Существующие бренды без группы — к «Гибкий эндоскоп» (или первой группе).
update public.reference_items brands
set
  parent_id = coalesce(
    (
      select g.id
      from public.reference_items g
      join public.reference_sets gs on gs.id = g.set_id and gs.code = 'device_groups'
      where g.code = 'flexible_endoscope'
      limit 1
    ),
    (
      select g.id
      from public.reference_items g
      join public.reference_sets gs on gs.id = g.set_id and gs.code = 'device_groups'
      order by g.sort_order, g.name
      limit 1
    )
  ),
  updated_at = now()
from public.reference_sets brand_set
where brand_set.id = brands.set_id
  and brand_set.code = 'device_brands'
  and brands.parent_id is null
  and exists (
    select 1
    from public.reference_items g
    join public.reference_sets gs on gs.id = g.set_id and gs.code = 'device_groups'
  );

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
    select s.code, i.parent_id into set_code, parent
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_brand_id and i.is_active = true;
    if set_code is distinct from 'device_brands' then
      raise exception 'Некорректный бренд прибора.';
    end if;
    if device_group_id is not null and parent is distinct from device_group_id then
      raise exception 'Бренд не относится к выбранной группе.';
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

-- -----------------------------------------------------------------------------
-- [47/73 | was 65/151] 20260829430000_update_device_serial.sql
-- -----------------------------------------------------------------------------

-- Разрешить смену серийного номера прибора при обновлении карточки.

drop function if exists public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb);

create or replace function public.update_device(
  target_device_id uuid,
  device_group_id uuid default null,
  device_brand_id uuid default null,
  device_model_id uuid default null,
  device_modification_id uuid default null,
  device_metadata jsonb default null,
  device_serial text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_serial text;
  next_serial text;
  conflict_id uuid;
begin
  if not public.has_permission('devices:update') then
    raise exception 'Недостаточно прав для изменения прибора.';
  end if;

  select serial_number into current_serial
  from public.devices
  where id = target_device_id;

  if current_serial is null then
    raise exception 'Прибор не найден.';
  end if;

  perform public.assert_device_classification(
    device_group_id, device_brand_id, device_model_id, device_modification_id
  );

  if device_serial is null then
    next_serial := current_serial;
  else
    next_serial := btrim(device_serial);
    if char_length(next_serial) < 1 then
      raise exception 'Укажите серийный номер.';
    end if;
  end if;

  if lower(next_serial) is distinct from lower(btrim(current_serial)) then
    select id into conflict_id
    from public.devices
    where id is distinct from target_device_id
      and lower(btrim(serial_number)) = lower(next_serial)
    limit 1;

    if conflict_id is not null then
      raise exception 'Прибор с таким серийным номером уже существует'
        using hint = conflict_id::text;
    end if;
  end if;

  update public.devices
  set
    serial_number = next_serial,
    group_id = device_group_id,
    brand_id = device_brand_id,
    model_id = device_model_id,
    modification_id = device_modification_id,
    metadata = coalesce(device_metadata, metadata)
  where id = target_device_id;

  if next_serial is distinct from current_serial then
    update public.orders
    set serial_number = next_serial
    where device_id = target_device_id
      and serial_number is distinct from next_serial;
  end if;

  perform public.record_audit(
    'devices.updated',
    'device',
    target_device_id::text,
    jsonb_build_object(
      'serial_number', next_serial,
      'previous_serial_number', current_serial
    )
  );
end;
$$;

revoke all on function public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb, text) from public;
grant execute on function public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [48/73 | was 66/151] 20260829440000_device_modification_samples.sql
-- -----------------------------------------------------------------------------

-- Демо-модификации под моделями Olympus (GIF-Q150, CF-Q150L).

insert into public.reference_items (set_id, parent_id, code, name, sort_order, is_system)
select mod_set.id, models.id, mods.code, mods.name, mods.sort_order, true
from (
  values
    ('gif_q150', 'gif_q150_std', 'Standard', 0),
    ('gif_q150', 'gif_q150_nbi', 'NBI', 1),
    ('cf_q150l', 'cf_q150l_std', 'Standard', 0)
) as mods(model_code, code, name, sort_order)
join public.reference_sets mod_set on mod_set.code = 'device_modifications'
join public.reference_items models on models.code = mods.model_code
join public.reference_sets model_set on model_set.id = models.set_id and model_set.code = 'device_models'
where not exists (
  select 1
  from public.reference_items existing
  where existing.set_id = mod_set.id
    and existing.code = mods.code
    and existing.parent_id is not distinct from models.id
);

-- -----------------------------------------------------------------------------
-- [49/73 | was 67/151] 20260829450000_order_custom_service_line.sql
-- -----------------------------------------------------------------------------

-- Custom order service lines without catalog template.

alter table public.order_service_lines
  add column if not exists description text not null default '';

create or replace function public.get_order_service_lines(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав для состава заказа.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'order_id', l.order_id,
      'template_id', l.template_id,
      'name', l.name,
      'description', coalesce(nullif(btrim(l.description), ''), t.description, ''),
      'quantity', l.quantity,
      'unit_price', l.unit_price,
      'actor_name', coalesce(p.full_name, p.email, ''),
      'created_at', l.created_at
    ) order by l.created_at)
    from public.order_service_lines l
    left join public.service_templates t on t.id = l.template_id
    left join public.profiles p on p.id = l.created_by
    where l.order_id = target_order_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.add_order_custom_service_line(
  target_order_id uuid,
  line_name text,
  line_description text default '',
  line_quantity numeric default 1,
  line_unit_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  clean_name text := btrim(coalesce(line_name, ''));
  clean_description text := btrim(coalesce(line_description, ''));
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.order_service_lines (
    order_id, template_id, name, description, quantity, unit_price, created_by
  )
  values (
    target_order_id,
    null,
    clean_name,
    clean_description,
    coalesce(line_quantity, 1),
    coalesce(line_unit_price, 0),
    auth.uid()
  )
  returning id into new_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'service_added',
    auth.uid(),
    'Добавлена услуга: ' || clean_name || ' × ' || trim(to_char(coalesce(line_quantity, 1), '999999990.999')),
    jsonb_build_object(
      'line_id', new_id,
      'custom', true,
      'quantity', coalesce(line_quantity, 1),
      'unit_price', coalesce(line_unit_price, 0)
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_line_added',
    'order',
    target_order_id::text,
    jsonb_build_object('line_id', new_id, 'name', clean_name, 'custom', true)
  );

  return new_id;
end;
$$;

revoke all on function public.add_order_custom_service_line(uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.add_order_custom_service_line(uuid, text, text, numeric, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- [50/73 | was 68/151] 20260829460000_order_custom_part_line.sql
-- -----------------------------------------------------------------------------

-- Custom order part lines without catalog inventory item (no stock move).

alter table public.order_part_lines
  alter column item_id drop not null;

alter table public.order_part_lines
  add column if not exists name text not null default '';

alter table public.order_part_lines
  drop constraint if exists order_part_lines_unique;

create unique index if not exists order_part_lines_order_item_unique
  on public.order_part_lines (order_id, item_id)
  where item_id is not null;

alter table public.order_part_lines
  drop constraint if exists order_part_lines_name_or_item;

alter table public.order_part_lines
  add constraint order_part_lines_name_or_item check (
    item_id is not null or btrim(name) <> ''
  );

create or replace function public.get_order_inventory_usage(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('orders:read')
    or public.can_read_inventory()
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        l.id,
        l.item_id,
        coalesce(nullif(btrim(l.name), ''), i.name, '') as item_name,
        coalesce(i.code, '') as item_code,
        coalesce(i.article, '') as item_article,
        coalesce(i.barcode, '') as item_barcode,
        coalesce(u.name, 'шт') as unit_name,
        l.quantity,
        l.unit_price,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'receipt_date', b.receipt_date,
            'supplier', b.supplier,
            'quantity', b.net_qty
          ) order by b.last_at desc)
          from (
            select
              bt.receipt_date,
              bt.supplier,
              -sum(m.quantity) as net_qty,
              max(m.created_at) as last_at
            from public.inventory_movements m
            join public.inventory_batches bt on bt.id = m.batch_id
            where m.reference_type = 'order'
              and m.reference_id = l.order_id
              and m.item_id = l.item_id
              and m.movement_type in ('repair_consumption', 'repair_return')
            group by bt.id, bt.receipt_date, bt.supplier
            having -sum(m.quantity) > 0
          ) b
        ), '[]'::jsonb) as batches,
        coalesce(p.full_name, '') as actor_name,
        l.created_at
      from public.order_part_lines l
      left join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      left join public.profiles p on p.id = l.created_by
      where l.order_id = target_order_id
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.add_order_custom_part_line(
  target_order_id uuid,
  line_name text,
  line_quantity numeric default 1,
  line_unit_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  clean_name text := btrim(coalesce(line_name, ''));
begin
  if not (
    public.has_permission('inventory:write_off')
    or public.has_permission('inventory:receive')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.order_part_lines (
    order_id, item_id, name, quantity, unit_price, created_by
  )
  values (
    target_order_id,
    null,
    clean_name,
    coalesce(line_quantity, 1),
    coalesce(line_unit_price, 0),
    auth.uid()
  )
  returning id into new_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'parts_consumed',
    auth.uid(),
    'Добавлена позиция: ' || clean_name || ' × ' || trim(to_char(coalesce(line_quantity, 1), '999999990.999')),
    jsonb_build_object(
      'line_id', new_id,
      'custom', true,
      'quantity', coalesce(line_quantity, 1),
      'unit_price', coalesce(line_unit_price, 0)
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'inventory.order_part_custom_added',
    'order',
    target_order_id::text,
    jsonb_build_object('line_id', new_id, 'name', clean_name, 'custom', true)
  );

  return new_id;
end;
$$;

create or replace function public.set_order_part_line(
  target_line_id uuid,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
  delta numeric;
begin
  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if current_row.item_id is null then
    if not (
      public.has_permission('inventory:write_off')
      or public.has_permission('orders:update')
    ) then
      raise exception 'Недостаточно прав для изменения запчастей заказа.';
    end if;
  elsif not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  delta := line_quantity - current_row.quantity;

  if current_row.item_id is not null then
    if delta > 0 then
      perform public.consume_inventory_fifo(
        current_row.item_id,
        delta,
        'repair_consumption',
        'order',
        current_row.order_id,
        true
      );
    elsif delta < 0 then
      perform public.return_inventory_from_order(current_row.order_id, current_row.item_id, -delta);
    end if;
  end if;

  update public.order_part_lines
  set quantity = line_quantity,
      unit_price = line_unit_price
  where id = target_line_id;

  perform public.record_audit(
    'inventory.order_part_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'item_id', current_row.item_id,
      'quantity', line_quantity,
      'unit_price', line_unit_price,
      'custom', current_row.item_id is null
    )
  );
end;
$$;

create or replace function public.remove_order_part_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
begin
  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if current_row.item_id is null then
    if not (
      public.has_permission('inventory:write_off')
      or public.has_permission('orders:update')
    ) then
      raise exception 'Недостаточно прав для удаления запчасти из заказа.';
    end if;
  elsif not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для удаления запчасти из заказа.';
  end if;

  if current_row.item_id is not null then
    perform public.return_inventory_from_order(
      current_row.order_id,
      current_row.item_id,
      current_row.quantity
    );
  end if;

  delete from public.order_part_lines
  where id = target_line_id;

  perform public.record_audit(
    'inventory.returned_repair',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'item_id', current_row.item_id,
      'quantity', current_row.quantity,
      'custom', current_row.item_id is null
    )
  );
end;
$$;

revoke all on function public.add_order_custom_part_line(uuid, text, numeric, numeric) from public, anon;
grant execute on function public.add_order_custom_part_line(uuid, text, numeric, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- [51/73 | was 69/151] 20260829470000_inventory_item_photos_label.sql
-- -----------------------------------------------------------------------------

-- Фото и тип этикетки для карточки позиции склада.

alter table public.inventory_items
  add column if not exists barcode_type text not null default 'code128';

alter table public.inventory_items
  drop constraint if exists inventory_items_barcode_type_check;

alter table public.inventory_items
  add constraint inventory_items_barcode_type_check
  check (barcode_type in ('code128', 'ean8', 'ean13', 'qr', 'upc_a'));

create table if not exists public.inventory_item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  file_path text not null,
  file_name text not null default '',
  mime_type text not null default 'image/jpeg',
  file_size integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_item_photos_item_idx
  on public.inventory_item_photos (item_id, sort_order, created_at);

alter table public.inventory_item_photos enable row level security;

drop policy if exists inventory_item_photos_select on public.inventory_item_photos;
create policy inventory_item_photos_select on public.inventory_item_photos
  for select to authenticated
  using (public.can_read_inventory());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-item-photos',
  'inventory-item-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do nothing;

drop policy if exists inventory_item_photos_select on storage.objects;
create policy inventory_item_photos_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'inventory-item-photos' and public.can_read_inventory());

drop policy if exists inventory_item_photos_insert on storage.objects;
create policy inventory_item_photos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'inventory-item-photos'
    and public.has_permission('inventory:receive')
  );

drop policy if exists inventory_item_photos_delete on storage.objects;
create policy inventory_item_photos_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'inventory-item-photos'
    and public.has_permission('inventory:receive')
  );

create or replace function public.set_inventory_item_label(
  target_item_id uuid,
  item_barcode text default '',
  item_barcode_type text default 'code128'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_type text;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для изменения этикетки.';
  end if;

  safe_type := lower(btrim(coalesce(item_barcode_type, 'code128')));
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
  end if;

  update public.inventory_items
  set
    barcode = btrim(coalesce(item_barcode, '')),
    barcode_type = safe_type,
    updated_at = now()
  where id = target_item_id;

  if not found then
    raise exception 'Позиция не найдена.';
  end if;
end;
$$;

create or replace function public.register_inventory_item_photo(
  target_item_id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для загрузки фото.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if btrim(coalesce(file_path, '')) = '' then
    raise exception 'Не указан файл.';
  end if;

  select coalesce(max(sort_order), -1) + 1
  into next_order
  from public.inventory_item_photos
  where item_id = target_item_id;

  insert into public.inventory_item_photos (
    item_id, file_path, file_name, mime_type, file_size, sort_order, created_by
  )
  values (
    target_item_id,
    file_path,
    coalesce(file_name, ''),
    coalesce(mime_type, 'image/jpeg'),
    greatest(coalesce(file_size, 0), 0),
    next_order,
    auth.uid()
  )
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.delete_inventory_item_photo(target_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_item_photos%rowtype;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления фото.';
  end if;

  select * into current_row
  from public.inventory_item_photos
  where id = target_photo_id
  for update;

  if current_row.id is null then
    raise exception 'Фото не найдено.';
  end if;

  delete from public.inventory_item_photos
  where id = target_photo_id;

  return current_row.file_path;
end;
$$;

create or replace function public.list_inventory_item_photos(target_item_id uuid)
returns table (
  id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer,
  sort_order integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра фото.';
  end if;

  return query
  select
    p.id,
    p.file_path,
    p.file_name,
    p.mime_type,
    p.file_size,
    p.sort_order,
    p.created_at
  from public.inventory_item_photos p
  where p.item_id = target_item_id
  order by p.sort_order, p.created_at;
end;
$$;

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'barcode_type', i.barcode_type,
    'name', i.name,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          rec.supplier_id,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        left join public.inventory_receipts rec on rec.id = bt.receipt_id
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        select
          m.id,
          m.quantity,
          m.unit_price,
          m.movement_type,
          m.reference_type,
          m.reference_id,
          m.created_at,
          m.batch_id,
          bt.receipt_date as batch_receipt_date,
          bt.supplier as batch_supplier,
          coalesce(p.full_name, '') as actor_name,
          case m.reference_type
            when 'order' then 'Заказ ' || coalesce(o.number, '')
            when 'receipt' then 'Приход · ' || coalesce(r.supplier, '')
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа · счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.delete_inventory_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_items%rowtype;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления номенклатуры.';
  end if;

  select * into current_row
  from public.inventory_items
  where id = target_item_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция не найдена.';
  end if;

  if exists (select 1 from public.inventory_batches where item_id = target_item_id)
    or exists (select 1 from public.inventory_movements where item_id = target_item_id)
    or exists (select 1 from public.sale_lines where item_id = target_item_id)
    or exists (select 1 from public.inventory_count_lines where item_id = target_item_id)
    or exists (select 1 from public.documents where source_type = 'item' and source_id = target_item_id)
  then
    raise exception 'Позицию нельзя удалить: по ней есть партии, движения или документы.';
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'inventory' and record_id = target_item_id;

  delete from public.inventory_item_photos
  where item_id = target_item_id;

  delete from public.inventory_items
  where id = target_item_id;

  perform public.record_audit(
    'inventory.item_deleted',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', current_row.name, 'code', current_row.code)
  );
end;
$$;

revoke all on function public.set_inventory_item_label(uuid, text, text) from public;
revoke all on function public.register_inventory_item_photo(uuid, text, text, text, integer) from public;
revoke all on function public.delete_inventory_item_photo(uuid) from public;
revoke all on function public.list_inventory_item_photos(uuid) from public;

grant execute on function public.set_inventory_item_label(uuid, text, text) to authenticated;
grant execute on function public.register_inventory_item_photo(uuid, text, text, text, integer) to authenticated;
grant execute on function public.delete_inventory_item_photo(uuid) to authenticated;
grant execute on function public.list_inventory_item_photos(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [52/73 | was 70/151] 20260829480000_profile_avatars.sql
-- -----------------------------------------------------------------------------

-- Аватар профиля: колонка, хранилище, RPC.

alter table public.profiles
  add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do nothing;

drop policy if exists profile_avatars_select on storage.objects;
create policy profile_avatars_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'profile-avatars');

drop policy if exists profile_avatars_insert on storage.objects;
create policy profile_avatars_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_avatars_update on storage.objects;
create policy profile_avatars_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_avatars_delete on storage.objects;
create policy profile_avatars_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.set_my_avatar(file_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
  safe_path text;
begin
  if auth.uid() is null then
    raise exception 'Нужна авторизация.';
  end if;

  safe_path := btrim(coalesce(file_path, ''));
  if safe_path = '' then
    raise exception 'Не указан файл аватара.';
  end if;

  if split_part(safe_path, '/', 1) <> auth.uid()::text then
    raise exception 'Нельзя сохранить чужой аватар.';
  end if;

  select avatar_path into old_path
  from public.profiles
  where id = auth.uid()
  for update;

  if not found then
    raise exception 'Профиль не найден.';
  end if;

  update public.profiles
  set avatar_path = safe_path, updated_at = now()
  where id = auth.uid();

  return coalesce(old_path, '');
end;
$$;

create or replace function public.clear_my_avatar()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
begin
  if auth.uid() is null then
    raise exception 'Нужна авторизация.';
  end if;

  select avatar_path into old_path
  from public.profiles
  where id = auth.uid()
  for update;

  if not found then
    raise exception 'Профиль не найден.';
  end if;

  update public.profiles
  set avatar_path = null, updated_at = now()
  where id = auth.uid();

  return coalesce(old_path, '');
end;
$$;

revoke all on function public.set_my_avatar(text) from public;
revoke all on function public.clear_my_avatar() from public;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.clear_my_avatar() to authenticated;

-- -----------------------------------------------------------------------------
-- [53/73 | was 71/151] 20260829490000_inventory_any_unit.sql
-- -----------------------------------------------------------------------------

-- Любая активная единица из справочника (не только шт/упак).

create or replace function public.assert_inventory_unit(target_unit_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = target_unit_id
      and s.code = 'units_of_measure'
      and i.is_active = true
  ) then
    raise exception 'Выберите единицу измерения.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- [54/73 | was 72/151] 20260829500000_fix_photo_uploads.sql
-- -----------------------------------------------------------------------------

-- Надёжные бакеты/политики для аватаров и фото позиций склада.

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.inventory_items
  add column if not exists barcode_type text not null default 'code128';

create table if not exists public.inventory_item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  file_path text not null,
  file_name text not null default '',
  mime_type text not null default 'image/jpeg',
  file_size integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.inventory_item_photos enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-item-photos',
  'inventory-item-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Аватары: путь userId/...
drop policy if exists profile_avatars_select on storage.objects;
drop policy if exists profile_avatars_public_select on storage.objects;
drop policy if exists profile_avatars_insert on storage.objects;
drop policy if exists profile_avatars_update on storage.objects;
drop policy if exists profile_avatars_delete on storage.objects;

create policy profile_avatars_public_select
  on storage.objects
  for select
  to public
  using (bucket_id = 'profile-avatars');

create policy profile_avatars_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy profile_avatars_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy profile_avatars_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Фото позиций: путь itemId/...
drop policy if exists inventory_item_photos_select on storage.objects;
drop policy if exists inventory_item_photos_insert on storage.objects;
drop policy if exists inventory_item_photos_update on storage.objects;
drop policy if exists inventory_item_photos_delete on storage.objects;

create policy inventory_item_photos_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'inventory-item-photos'
    and public.can_read_inventory()
  );

create policy inventory_item_photos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'inventory-item-photos'
    and public.has_permission('inventory:receive')
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

create policy inventory_item_photos_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'inventory-item-photos'
    and public.has_permission('inventory:receive')
  );

-- RLS на таблице фото (если политика ещё не создана)
drop policy if exists inventory_item_photos_select on public.inventory_item_photos;
create policy inventory_item_photos_select on public.inventory_item_photos
  for select to authenticated
  using (public.can_read_inventory());

-- RPC аватара (на случай, если 2948 не применили)
create or replace function public.set_my_avatar(file_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
  safe_path text;
begin
  if auth.uid() is null then
    raise exception 'Нужна авторизация.';
  end if;

  safe_path := btrim(coalesce(file_path, ''));
  if safe_path = '' then
    raise exception 'Не указан файл аватара.';
  end if;

  if split_part(safe_path, '/', 1) <> auth.uid()::text then
    raise exception 'Нельзя сохранить чужой аватар.';
  end if;

  select avatar_path into old_path
  from public.profiles
  where id = auth.uid()
  for update;

  if not found then
    raise exception 'Профиль не найден.';
  end if;

  update public.profiles
  set avatar_path = safe_path, updated_at = now()
  where id = auth.uid();

  return coalesce(old_path, '');
end;
$$;

create or replace function public.clear_my_avatar()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
begin
  if auth.uid() is null then
    raise exception 'Нужна авторизация.';
  end if;

  select avatar_path into old_path
  from public.profiles
  where id = auth.uid()
  for update;

  if not found then
    raise exception 'Профиль не найден.';
  end if;

  update public.profiles
  set avatar_path = null, updated_at = now()
  where id = auth.uid();

  return coalesce(old_path, '');
end;
$$;

revoke all on function public.set_my_avatar(text) from public;
revoke all on function public.clear_my_avatar() from public;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.clear_my_avatar() to authenticated;

-- RPC фото склада (на случай, если 2947 не применили)
create or replace function public.register_inventory_item_photo(
  target_item_id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для загрузки фото.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if btrim(coalesce(file_path, '')) = '' then
    raise exception 'Не указан файл.';
  end if;

  if split_part(file_path, '/', 1) <> target_item_id::text then
    raise exception 'Некорректный путь файла.';
  end if;

  select coalesce(max(sort_order), -1) + 1
  into next_order
  from public.inventory_item_photos
  where item_id = target_item_id;

  insert into public.inventory_item_photos (
    item_id, file_path, file_name, mime_type, file_size, sort_order, created_by
  )
  values (
    target_item_id,
    file_path,
    coalesce(file_name, ''),
    coalesce(mime_type, 'image/jpeg'),
    greatest(coalesce(file_size, 0), 0),
    next_order,
    auth.uid()
  )
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.delete_inventory_item_photo(target_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_item_photos%rowtype;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления фото.';
  end if;

  select * into current_row
  from public.inventory_item_photos
  where id = target_photo_id
  for update;

  if current_row.id is null then
    raise exception 'Фото не найдено.';
  end if;

  delete from public.inventory_item_photos
  where id = target_photo_id;

  return current_row.file_path;
end;
$$;

create or replace function public.list_inventory_item_photos(target_item_id uuid)
returns table (
  id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer,
  sort_order integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра фото.';
  end if;

  return query
  select
    p.id,
    p.file_path,
    p.file_name,
    p.mime_type,
    p.file_size,
    p.sort_order,
    p.created_at
  from public.inventory_item_photos p
  where p.item_id = target_item_id
  order by p.sort_order, p.created_at;
end;
$$;

revoke all on function public.register_inventory_item_photo(uuid, text, text, text, integer) from public;
revoke all on function public.delete_inventory_item_photo(uuid) from public;
revoke all on function public.list_inventory_item_photos(uuid) from public;
grant execute on function public.register_inventory_item_photo(uuid, text, text, text, integer) to authenticated;
grant execute on function public.delete_inventory_item_photo(uuid) to authenticated;
grant execute on function public.list_inventory_item_photos(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [55/73 | was 73/151] 20260829510000_update_order_custom_lines.sql
-- -----------------------------------------------------------------------------

-- Редактирование строк состава, созданных только для заказа (без справочника).

create or replace function public.update_order_custom_part_line(
  target_line_id uuid,
  line_name text,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
  clean_name text := btrim(coalesce(line_name, ''));
begin
  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if current_row.item_id is not null then
    raise exception 'Эта позиция из справочника. Измените карточку товара.';
  end if;

  if not (
    public.has_permission('inventory:write_off')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.order_part_lines
  set
    name = clean_name,
    quantity = line_quantity,
    unit_price = line_unit_price
  where id = target_line_id;

  perform public.record_audit(
    'inventory.order_custom_part_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;

create or replace function public.update_order_custom_service_line(
  target_line_id uuid,
  line_name text,
  line_description text,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order uuid;
  clean_name text := btrim(coalesce(line_name, ''));
  clean_description text := btrim(coalesce(line_description, ''));
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.order_service_lines
  set
    name = clean_name,
    description = clean_description,
    quantity = line_quantity,
    unit_price = line_unit_price
  where id = target_line_id
    and template_id is null
  returning order_id into target_order;

  if target_order is null then
    raise exception 'Строка услуги не найдена или это шаблон из справочника.';
  end if;

  perform public.write_audit_event(
    auth.uid(),
    'orders.custom_service_updated',
    'order',
    target_order::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;

revoke all on function public.update_order_custom_part_line(uuid, text, numeric, numeric) from public, anon;
grant execute on function public.update_order_custom_part_line(uuid, text, numeric, numeric) to authenticated;

revoke all on function public.update_order_custom_service_line(uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.update_order_custom_service_line(uuid, text, text, numeric, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- [56/73 | was 74/151] 20260829520000_fix_device_brand_group_links.sql
-- -----------------------------------------------------------------------------

-- Бренды принадлежат группам (parent_set). Без автосоздания производителей.

update public.reference_sets brands
set
  parent_set_id = groups.id,
  description = coalesce(brands.description, 'Производители в рамках группы приборов'),
  updated_at = now()
from public.reference_sets groups
where brands.code = 'device_brands'
  and groups.code = 'device_groups'
  and brands.parent_set_id is distinct from groups.id;

-- -----------------------------------------------------------------------------
-- [57/73 | was 75/151] 20260829530000_remove_device_classification_seeds.sql
-- -----------------------------------------------------------------------------

-- Убрать демо-бренды / модели / модификации.
-- Снизу вверх: сначала модификации и модели (в т.ч. дочерние), потом бренды.

with brands_to_drop as (
  select i.id
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id
  where s.code = 'device_brands'
    and (
      i.is_system
      or i.code in ('olympus', 'pentax', 'fujifilm', 'karl_storz', 'other')
    )
),
models_to_drop as (
  select i.id
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id
  where s.code = 'device_models'
    and (
      i.is_system
      or i.code in ('gif_q150', 'cf_q150l')
      or i.parent_id in (select id from brands_to_drop)
    )
),
mods_to_drop as (
  select i.id
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id
  where s.code = 'device_modifications'
    and (
      i.is_system
      or i.code in ('gif_q150_std', 'gif_q150_nbi', 'cf_q150l_std')
      or i.parent_id in (select id from models_to_drop)
    )
),
deleted_mods as (
  delete from public.reference_items
  where id in (select id from mods_to_drop)
  returning id
),
deleted_models as (
  delete from public.reference_items
  where id in (select id from models_to_drop)
  returning id
)
delete from public.reference_items
where id in (select id from brands_to_drop);

-- -----------------------------------------------------------------------------
-- [58/73 | was 76/151] 20260829540000_allow_delete_order_journal.sql
-- -----------------------------------------------------------------------------

-- Удаление заказа каскадом трогает order_journal_events, а триггер
-- запрещал DELETE → «Записи журнала нельзя изменять».
-- Журнал по-прежнему нельзя править (UPDATE); удалять строки можно
-- только вместе с заказом (cascade / delete_order). Прямого DELETE у клиентов нет.

create or replace function public.forbid_order_journal_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Записи журнала нельзя изменять.';
end;
$$;

drop trigger if exists order_journal_events_no_update on public.order_journal_events;
create trigger order_journal_events_no_update
  before update on public.order_journal_events
  for each row execute procedure public.forbid_order_journal_mutation();

create or replace function public.delete_order(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
begin
  if not public.has_permission('orders:delete') then
    raise exception 'Недостаточно прав для удаления заказа.';
  end if;

  select * into current_row
  from public.orders
  where id = target_order_id
  for update;

  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  delete from public.device_warranties
  where order_id = target_order_id;

  delete from public.documents
  where source_type = 'order' and source_id = target_order_id;

  delete from public.dynamic_field_values
  where record_id = target_order_id
    and entity_code in ('orders', 'diagnostics');

  -- Явно до cascade: журнал и вложения уходят вместе с заказом.
  delete from public.order_journal_events
  where order_id = target_order_id;

  delete from public.orders
  where id = target_order_id;

  perform public.record_audit(
    'orders.deleted',
    'order',
    target_order_id::text,
    jsonb_build_object('number', current_row.number)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- [59/73 | was 77/151] 20260829550000_reference_item_unique_per_parent.sql
-- -----------------------------------------------------------------------------

-- Код уникален среди «соседей» (set + parent), не во всём справочнике:
-- одна модель под разными брендами — ок; два одинаковых бренда в одной группе — нет.

alter table public.reference_items
  drop constraint if exists reference_items_set_code_unique;

drop index if exists public.reference_items_set_code_unique;
drop index if exists public.reference_items_set_code_uidx;

create unique index if not exists reference_items_set_parent_code_uidx
  on public.reference_items (set_id, parent_id, code)
  where parent_id is not null;

create unique index if not exists reference_items_set_root_code_uidx
  on public.reference_items (set_id, code)
  where parent_id is null;

-- Название без дублей среди соседей (если уже есть дубликаты — индекс не создаём).
do $$
begin
  if not exists (
    select 1
    from public.reference_items
    where parent_id is not null
    group by set_id, parent_id, lower(btrim(name))
    having count(*) > 1
  ) then
    create unique index if not exists reference_items_set_parent_name_uidx
      on public.reference_items (set_id, parent_id, lower(btrim(name)))
      where parent_id is not null;
  end if;

  if not exists (
    select 1
    from public.reference_items
    where parent_id is null
    group by set_id, lower(btrim(name))
    having count(*) > 1
  ) then
    create unique index if not exists reference_items_set_root_name_uidx
      on public.reference_items (set_id, lower(btrim(name)))
      where parent_id is null;
  end if;
end $$;

create or replace function public.upsert_reference_item(
  target_id uuid,
  target_set_id uuid,
  item_code text,
  item_name text,
  item_description text default '',
  parent_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  normalized_name text;
  current_row public.reference_items%rowtype;
  result_id uuid;
  next_sort integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.reference_sets where id = target_set_id) then
    raise exception 'Справочник не найден.';
  end if;

  normalized_code := lower(btrim(coalesce(item_code, '')));
  normalized_name := btrim(coalesce(item_name, ''));

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if target_id is not null then
    select * into current_row from public.reference_items where id = target_id and set_id = target_set_id;
    if current_row.id is null then
      raise exception 'Запись справочника не найдена.';
    end if;

    if current_row.is_system and current_row.code <> normalized_code then
      raise exception 'Код системной записи нельзя изменить.';
    end if;

    update public.reference_items
    set
      code = case when current_row.is_system then current_row.code else normalized_code end,
      name = normalized_name,
      description = btrim(coalesce(item_description, '')),
      parent_id = parent_item_id
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.reference_items
    where set_id = target_set_id;

    insert into public.reference_items (set_id, parent_id, code, name, description, sort_order)
    values (
      target_set_id,
      parent_item_id,
      normalized_code,
      normalized_name,
      btrim(coalesce(item_description, '')),
      next_sort
    )
    returning id into result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'references.item_created' else 'references.item_updated' end,
    'reference_item',
    result_id::text,
    jsonb_build_object('set_id', target_set_id, 'code', normalized_code)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Запись с таким названием уже есть на этом уровне.';
end;
$$;

-- -----------------------------------------------------------------------------
-- [60/73 | was 78/151] 20260829560000_fix_order_part_conflict_and_qty.sql
-- -----------------------------------------------------------------------------

-- После partial unique index (order_id, item_id) WHERE item_id IS NOT NULL
-- обычный ON CONFLICT (order_id, item_id) падает:
-- «there is no unique or exclusion constraint matching the ON CONFLICT specification».

create or replace function public.format_quantity_label(value numeric)
returns text
language plpgsql
immutable
as $$
declare
  n numeric := round(coalesce(value, 0), 3);
  negative boolean := n < 0;
  abs_n numeric := abs(n);
  whole bigint := trunc(abs_n);
  frac numeric := abs_n - whole;
  grouped text;
  raw text;
  frac_text text;
begin
  grouped := reverse(regexp_replace(reverse(whole::text), '(\d{3})(?=\d)', '\1 ', 'g'));
  if frac = 0 then
    return case when negative then '-' else '' end || grouped;
  end if;
  raw := trim(to_char(abs_n, 'FM999999990.999'));
  frac_text := split_part(raw, '.', 2);
  return case when negative then '-' else '' end || grouped || '.' || frac_text;
end;
$$;

create or replace function public.consume_inventory_for_order(
  target_order_id uuid,
  target_item_id uuid,
  consume_quantity numeric,
  line_unit_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  next_price numeric;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания в ремонт.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  next_price := line_unit_price;
  if next_price is null then
    select repair_price into next_price
    from public.inventory_items
    where id = target_item_id;
  end if;

  if next_price is null or next_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  result := public.consume_inventory_fifo(
    target_item_id,
    consume_quantity,
    'repair_consumption',
    'order',
    target_order_id,
    true
  );

  insert into public.order_part_lines (order_id, item_id, quantity, unit_price, created_by)
  values (target_order_id, target_item_id, consume_quantity, next_price, auth.uid())
  on conflict (order_id, item_id) where item_id is not null
  do update
    set quantity = public.order_part_lines.quantity + excluded.quantity;

  perform public.record_audit(
    'inventory.consumed_repair',
    'order',
    target_order_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity', consume_quantity, 'unit_price', next_price)
  );

  return result;
end;
$$;

-- Журнал: количества без лишних «.000», тысячи через пробел.
create or replace function public.write_order_journal_on_parts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.reference_type <> 'order'
     or new.movement_type not in ('repair_consumption', 'repair_return') then
    return new;
  end if;

  select name into item_name from public.inventory_items where id = new.item_id;

  if new.movement_type = 'repair_return' then
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      new.reference_id,
      'parts_returned',
      auth.uid(),
      'Возвращено на склад: ' || coalesce(item_name, 'позиция') || ' × ' || public.format_quantity_label(abs(new.quantity)),
      jsonb_build_object(
        'item_id', new.item_id,
        'quantity', abs(new.quantity),
        'movement_id', new.id
      )
    );
  else
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      new.reference_id,
      'parts_consumed',
      auth.uid(),
      'Списано: ' || coalesce(item_name, 'позиция') || ' × ' || public.format_quantity_label(abs(new.quantity)),
      jsonb_build_object(
        'item_id', new.item_id,
        'quantity', abs(new.quantity),
        'movement_id', new.id
      )
    );
  end if;

  return new;
end;
$$;

create or replace function public.add_order_custom_part_line(
  target_order_id uuid,
  line_name text,
  line_quantity numeric default 1,
  line_unit_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  clean_name text := btrim(coalesce(line_name, ''));
  qty numeric := coalesce(line_quantity, 1);
begin
  if not (
    public.has_permission('inventory:write_off')
    or public.has_permission('inventory:receive')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if qty <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.order_part_lines (
    order_id, item_id, name, quantity, unit_price, created_by
  )
  values (
    target_order_id,
    null,
    clean_name,
    qty,
    coalesce(line_unit_price, 0),
    auth.uid()
  )
  returning id into new_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'parts_consumed',
    auth.uid(),
    'Добавлена позиция: ' || clean_name || ' × ' || public.format_quantity_label(qty),
    jsonb_build_object(
      'line_id', new_id,
      'custom', true,
      'quantity', qty,
      'unit_price', coalesce(line_unit_price, 0)
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'inventory.order_part_custom_added',
    'order',
    target_order_id::text,
    jsonb_build_object('line_id', new_id, 'name', clean_name, 'custom', true)
  );

  return new_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- [61/73 | was 79/151] 20260829570000_sync_catalog_to_order_lines.sql
-- -----------------------------------------------------------------------------

-- Правка шаблона услуги / карточки товара синхронизирует строки в заказах
-- (название, описание, цена), которые ссылаются на справочник.

create or replace function public.update_service_template(
  target_id uuid,
  template_name text,
  template_description text default '',
  template_unit_price numeric default 0,
  template_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := btrim(coalesce(template_name, ''));
  clean_description text := btrim(coalesce(template_description, ''));
  clean_price numeric := coalesce(template_unit_price, 0);
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения услуги.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if clean_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if exists (
    select 1
    from public.service_templates
    where lower(btrim(name)) = lower(clean_name)
      and id <> target_id
  ) then
    raise exception 'Такое наименование уже в справочнике';
  end if;

  update public.service_templates
  set
    name = clean_name,
    description = clean_description,
    unit_price = clean_price,
    is_active = coalesce(template_is_active, true)
  where id = target_id;

  if not found then
    raise exception 'Услуга не найдена.';
  end if;

  update public.order_service_lines
  set
    name = clean_name,
    description = clean_description,
    unit_price = clean_price
  where template_id = target_id;

  perform public.write_audit_event(
    auth.uid(),
    'services.template_updated',
    'service_template',
    target_id::text,
    jsonb_build_object('name', clean_name)
  );
end;
$$;

create or replace function public.update_inventory_item(
  target_item_id uuid,
  item_name text,
  item_code text default '',
  item_article text default '',
  item_barcode text default '',
  item_category_id uuid default null,
  item_unit_id uuid default null,
  item_purchase_price numeric default 0,
  item_repair_price numeric default 0,
  item_retail_price numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_code text;
  clean_name text := btrim(coalesce(item_name, ''));
  clean_repair numeric := coalesce(item_repair_price, 0);
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для изменения номенклатуры.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if item_category_id is null or item_unit_id is null then
    raise exception 'Категория и единица измерения обязательны.';
  end if;

  perform public.assert_inventory_category(item_category_id);
  perform public.assert_inventory_unit(item_unit_id);

  if coalesce(item_purchase_price, 0) < 0 or clean_repair < 0 or coalesce(item_retail_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    select code into next_code from public.inventory_items where id = target_item_id;
  end if;

  update public.inventory_items
  set
    code = next_code,
    article = btrim(coalesce(item_article, '')),
    barcode = btrim(coalesce(item_barcode, '')),
    name = clean_name,
    category_id = item_category_id,
    unit_id = item_unit_id,
    purchase_price = coalesce(item_purchase_price, 0),
    repair_price = clean_repair,
    retail_price = coalesce(item_retail_price, 0)
  where id = target_item_id;

  update public.order_part_lines
  set
    name = clean_name,
    unit_price = clean_repair
  where item_id = target_item_id;

  perform public.record_audit(
    'inventory.item_updated',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', clean_name, 'code', next_code)
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
end;
$$;

-- -----------------------------------------------------------------------------
-- [62/73 | was 80/151] 20260829580000_order_list_device_filter_ids.sql
-- -----------------------------------------------------------------------------

-- Фильтры доски/списка заказов: id группы/бренда/модели прибора.
-- CREATE OR REPLACE VIEW не может менять имена/порядок колонок — пересоздаём.

drop view if exists public.order_list_items;

create view public.order_list_items
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
  coalesce(brand.name, '') as device_brand,
  coalesce(model.name, '') as device_model,
  public.device_display_name(grp.name, brand.name, model.name) as device_label,
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
left join public.reference_items grp on grp.id = d.group_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id;

grant select on public.order_list_items to authenticated;

-- -----------------------------------------------------------------------------
-- [63/73 | was 81/151] 20260829590000_order_ready_date_document_fields.sql
-- -----------------------------------------------------------------------------

-- Дата готовности заказа + значения полей карточек в контексте документов.

alter table public.orders
  add column if not exists ready_date date;

update public.dynamic_fields
set sort_order = 4
where entity_code = 'orders' and code = 'responsible' and sort_order < 4;

insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
values
  ('orders', 'ready_date', 'Дата готовности', 'date', false, 3, 'Заказ')
on conflict (entity_code, code) do update
set
  name = excluded.name,
  field_type = excluded.field_type,
  group_name = case
    when public.dynamic_fields.group_name = '' then excluded.group_name
    else public.dynamic_fields.group_name
  end;

create or replace function public.is_order_card_field(p_entity text, p_code text)
returns boolean
language sql
immutable
as $$
  select p_entity = 'orders'
    and p_code in (
      'claimed_malfunction',
      'completeness',
      'deadline',
      'ready_date',
      'responsible'
    );
$$;

create or replace function public.document_field_value_text(
  p_field_type text,
  p_value jsonb,
  p_field_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw_text text;
  option_label text;
  employee_name text;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return '';
  end if;

  if p_field_type = 'checkbox' then
    if p_value = 'true'::jsonb then
      return 'Да';
    end if;
    if p_value = 'false'::jsonb then
      return 'Нет';
    end if;
    return '';
  end if;

  if p_field_type = 'number' then
    if jsonb_typeof(p_value) = 'number' then
      return trim(to_char((p_value #>> '{}')::numeric, '999999990.999'));
    end if;
    raw_text := btrim(coalesce(p_value #>> '{}', ''));
    return raw_text;
  end if;

  if p_field_type = 'date' then
    raw_text := btrim(coalesce(p_value #>> '{}', ''));
    if raw_text = '' then
      return '';
    end if;
    begin
      return to_char(raw_text::date, 'YYYY-MM-DD');
    exception
      when others then
        return raw_text;
    end;
  end if;

  if p_field_type = 'select' then
    raw_text := btrim(coalesce(p_value #>> '{}', ''));
    if raw_text = '' or p_field_id is null then
      return raw_text;
    end if;
    select o.label into option_label
    from public.dynamic_field_options o
    where o.field_id = p_field_id
      and o.code = raw_text
    limit 1;
    return coalesce(option_label, raw_text);
  end if;

  if p_field_type = 'employee' then
    raw_text := btrim(coalesce(p_value #>> '{}', ''));
    if raw_text = '' then
      return '';
    end if;
    begin
      select coalesce(nullif(p.full_name, ''), p.email, '') into employee_name
      from public.profiles p
      where p.id = raw_text::uuid;
    exception
      when others then
        return raw_text;
    end;
    return coalesce(employee_name, raw_text);
  end if;

  return btrim(coalesce(p_value #>> '{}', ''));
end;
$$;

create or replace function public.document_dynamic_field_values(
  p_entity text,
  p_record_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb := '{}'::jsonb;
  field_row record;
  text_value text;
  key text;
begin
  if p_record_id is null then
    return result;
  end if;

  for field_row in
    select f.id, f.code, f.field_type, v.value
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id
     and v.record_id = p_record_id
    where f.entity_code = p_entity
      and f.is_active = true
      and not public.is_order_card_field(f.entity_code, f.code)
  loop
    text_value := public.document_field_value_text(field_row.field_type, field_row.value, field_row.id);
    key := 'field.' || p_entity || '.' || field_row.code;
    result := result || jsonb_build_object(key, coalesce(text_value, ''));
  end loop;

  return result;
end;
$$;

create or replace function public.empty_document_values()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'company.name', 'Эндотека',
    'document.number', '',
    'document.issuedAt', '',
    'order.number', '',
    'order.createdAt', '',
    'order.status', '',
    'order.claimedMalfunction', '',
    'order.completeness', '',
    'order.externalCondition', '',
    'order.deadline', '',
    'order.readyDate', '',
    'order.responsible', '',
    'customer.name', '',
    'customer.phone', '',
    'customer.email', '',
    'customer.inn', '',
    'customer.city', '',
    'customer.contactName', '',
    'device.serialNumber', '',
    'device.model', '',
    'device.brand', '',
    'device.group', '',
    'device.label', '',
    'sale.invoiceNumber', '',
    'sale.date', '',
    'sale.total', '',
    'sale.customerName', '',
    'sale.status', '',
    'item.name', '',
    'item.code', '',
    'item.article', '',
    'item.barcode', '',
    'part.name', '',
    'part.code', '',
    'part.article', '',
    'part.quantity', '',
    'part.unitName', '',
    'part.price', '',
    'line.name', '',
    'line.code', '',
    'line.article', '',
    'line.quantity', '',
    'line.unitName', '',
    'line.price', '',
    'line.amount', ''
  );
$$;

drop function if exists public.create_order(uuid, uuid, text, text, text, date, uuid);

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
  device_serial text;
  initial_status uuid;
  malfunction text;
begin
  if not public.has_permission('orders:create') then
    raise exception 'Недостаточно прав для создания заказа.';
  end if;

  malfunction := btrim(coalesce(claimed_malfunction, ''));

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
    deadline, ready_date, responsible_id, status_id, created_by
  )
  values (
    v_number, v_seq, target_customer_id, target_device_id, device_serial,
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

drop function if exists public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean
);

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
    or target_ready_date is not null
    or clear_ready_date
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
    ready_date = case
      when clear_ready_date then null
      when target_ready_date is not null then target_ready_date
      else orders.ready_date
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

create or replace function public.build_document_context(
  p_source_type text,
  p_source_id uuid,
  p_document_number text default '',
  p_issued_at text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  doc_values jsonb := public.empty_document_values();
  parts jsonb := '[]'::jsonb;
  lines jsonb := '[]'::jsonb;
  first_part jsonb;
  first_line jsonb;
  order_customer_id uuid;
  order_device_id uuid;
begin
  doc_values := doc_values || jsonb_build_object(
    'document.number', coalesce(p_document_number, ''),
    'document.issuedAt', coalesce(p_issued_at, '')
  );

  if p_source_type = 'order' then
    if not public.has_permission('orders:read') then
      raise exception 'Недостаточно прав для данных заказа.';
    end if;

    select
      doc_values || jsonb_build_object(
        'order.number', o.number,
        'order.createdAt', to_char(o.created_at, 'YYYY-MM-DD'),
        'order.status', coalesce(st.name, ''),
        'order.claimedMalfunction', o.claimed_malfunction,
        'order.completeness', o.completeness,
        'order.externalCondition', o.external_condition,
        'order.deadline', coalesce(to_char(o.deadline, 'YYYY-MM-DD'), ''),
        'order.readyDate', coalesce(to_char(o.ready_date, 'YYYY-MM-DD'), ''),
        'order.responsible', coalesce(resp.full_name, ''),
        'customer.name', coalesce(c.name, ''),
        'customer.phone', coalesce(c.phone, ''),
        'customer.email', coalesce(c.email, ''),
        'customer.inn', coalesce(c.inn, ''),
        'customer.city', coalesce(c.city, ''),
        'customer.contactName', coalesce(c.contact_name, ''),
        'device.serialNumber', coalesce(o.serial_number, ''),
        'device.model', coalesce(model.name, ''),
        'device.brand', coalesce(brand.name, ''),
        'device.group', coalesce(grp.name, ''),
        'device.label', trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), o.serial_number))
      ),
      o.customer_id,
      o.device_id
    into doc_values, order_customer_id, order_device_id
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join public.devices d on d.id = o.device_id
    left join public.reference_items st on st.id = o.status_id
    left join public.reference_items grp on grp.id = d.group_id
    left join public.reference_items brand on brand.id = d.brand_id
    left join public.reference_items model on model.id = d.model_id
    left join public.profiles resp on resp.id = o.responsible_id
    where o.id = p_source_id;

    if doc_values is null then
      raise exception 'Заказ не найден.';
    end if;

    doc_values := doc_values
      || public.document_dynamic_field_values('orders', p_source_id)
      || public.document_dynamic_field_values('customers', order_customer_id)
      || public.document_dynamic_field_values('devices', order_device_id)
      || public.document_dynamic_field_values('diagnostics', p_source_id);

    select coalesce(jsonb_agg(jsonb_build_object(
      'part.name', x.item_name,
      'part.code', x.item_code,
      'part.article', x.item_article,
      'part.quantity', x.quantity,
      'part.unitName', x.unit_name,
      'part.price', x.unit_price
    ) order by x.created_at), '[]'::jsonb)
    into parts
    from (
      select
        i.name as item_name,
        i.code as item_code,
        i.article as item_article,
        trim(to_char(l.quantity, '999999990.999')) as quantity,
        coalesce(u.name, '') as unit_name,
        trim(to_char(l.unit_price, '999999990.99')) as unit_price,
        l.created_at
      from public.order_part_lines l
      join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      where l.order_id = p_source_id
    ) x;

    first_part := parts -> 0;
    if first_part is not null then
      doc_values := doc_values || first_part;
    end if;
  elsif p_source_type = 'sale' then
    if not public.has_permission('sales:read') then
      raise exception 'Недостаточно прав для данных продажи.';
    end if;

    select
      doc_values || jsonb_build_object(
        'sale.invoiceNumber', s.invoice_number,
        'sale.date', to_char(s.sale_date, 'YYYY-MM-DD'),
        'sale.total', trim(to_char(s.total, '999999990.99')),
        'sale.customerName', coalesce(c.name, ''),
        'sale.status', case s.status
          when 'draft' then 'Черновик'
          when 'confirmed' then 'Подтверждена'
          when 'cancelled' then 'Отменена'
          else s.status
        end,
        'customer.name', coalesce(c.name, ''),
        'customer.phone', coalesce(c.phone, ''),
        'customer.email', coalesce(c.email, ''),
        'customer.inn', coalesce(c.inn, ''),
        'customer.city', coalesce(c.city, ''),
        'customer.contactName', coalesce(c.contact_name, '')
      ),
      s.customer_id
    into doc_values, order_customer_id
    from public.sales s
    left join public.customers c on c.id = s.customer_id
    where s.id = p_source_id;

    if doc_values is null then
      raise exception 'Продажа не найдена.';
    end if;

    doc_values := doc_values || public.document_dynamic_field_values('customers', order_customer_id);

    select coalesce(jsonb_agg(jsonb_build_object(
      'line.name', i.name,
      'line.code', i.code,
      'line.article', i.article,
      'line.quantity', trim(to_char(l.quantity, '999999990.999')),
      'line.unitName', coalesce(u.name, ''),
      'line.price', trim(to_char(l.unit_price, '999999990.99')),
      'line.amount', trim(to_char(l.amount, '999999990.99'))
    ) order by l.sort_order, l.created_at), '[]'::jsonb)
    into lines
    from public.sale_lines l
    join public.inventory_items i on i.id = l.item_id
    left join public.reference_items u on u.id = i.unit_id
    where l.sale_id = p_source_id;

    first_line := lines -> 0;
    if first_line is not null then
      doc_values := doc_values || first_line;
    end if;
  elsif p_source_type = 'item' then
    if not (
      public.can_read_inventory()
      or public.has_permission('orders:read')
      or public.has_permission('sales:read')
    ) then
      raise exception 'Недостаточно прав для данных номенклатуры.';
    end if;

    select doc_values || jsonb_build_object(
      'item.name', i.name,
      'item.code', i.code,
      'item.article', i.article,
      'item.barcode', i.barcode,
      'part.name', i.name,
      'part.code', i.code,
      'part.article', i.article
    )
    into doc_values
    from public.inventory_items i
    where i.id = p_source_id;

    if doc_values is null then
      raise exception 'Позиция не найдена.';
    end if;

    doc_values := doc_values || public.document_dynamic_field_values('inventory', p_source_id);
  elsif p_source_type <> 'none' then
    raise exception 'Неизвестный источник документа.';
  end if;

  return jsonb_build_object(
    'values', doc_values,
    'parts', coalesce(parts, '[]'::jsonb),
    'lines', coalesce(lines, '[]'::jsonb)
  );
end;
$$;

create or replace function public.issue_document(target_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.documents%rowtype;
  template_body jsonb;
  issued_label text;
  context jsonb;
  updated_id uuid;
begin
  perform public.assert_documents_create();

  select * into current_row
  from public.documents
  where id = target_document_id
  for update;

  if current_row.id is null then
    raise exception 'Документ не найден.';
  end if;

  if current_row.status = 'issued' then
    raise exception 'Документ уже выпущен.';
  end if;

  select body into template_body
  from public.document_templates
  where id = current_row.template_id;

  issued_label := to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS');
  context := public.build_document_context(
    current_row.source_type,
    current_row.source_id,
    current_row.number,
    issued_label
  );

  update public.documents
  set status = 'issued',
      issued_at = now(),
      body = coalesce(template_body, body),
      context = context
  where id = target_document_id
    and status = 'draft'
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Документ уже выпущен.';
  end if;

  perform public.record_audit(
    'document.issued',
    'document',
    target_document_id::text,
    jsonb_build_object('number', current_row.number)
  );
end;
$$;

revoke all on function public.document_field_value_text(text, jsonb, uuid) from public, anon;
revoke all on function public.document_dynamic_field_values(text, uuid) from public, anon;
revoke all on function public.create_order(uuid, uuid, text, text, text, date, uuid, date) from public, anon;
revoke all on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean
) from public, anon;

grant execute on function public.create_order(uuid, uuid, text, text, text, date, uuid, date) to authenticated;
grant execute on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean
) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [64/73 | was 82/151] 20260829600000_fix_reference_item_sibling_unique.sql
-- -----------------------------------------------------------------------------

-- Код и название уникальны только среди соседей (один set + один parent).
-- Старый unique (set_id, code) и старый текст ошибки «таким кодом» ломали
-- одинаковые названия у разных родителей (тип «тест» + производитель «тест»).

alter table public.reference_items
  drop constraint if exists reference_items_set_code_unique;

drop index if exists public.reference_items_set_code_unique;
drop index if exists public.reference_items_set_code_uidx;

-- На всякий случай убрать любые другие unique только по (set_id, code).
do $$
declare
  idx record;
begin
  for idx in
    select i.relname as index_name
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'reference_items'
      and x.indisunique
      and not x.indisprimary
      and pg_get_indexdef(x.indexrelid) ~* '\(set_id,\s*code\)'
      and pg_get_indexdef(x.indexrelid) !~* 'parent_id'
  loop
    execute format('drop index if exists public.%I', idx.index_name);
  end loop;
end $$;

create unique index if not exists reference_items_set_parent_code_uidx
  on public.reference_items (set_id, parent_id, code)
  where parent_id is not null;

create unique index if not exists reference_items_set_root_code_uidx
  on public.reference_items (set_id, code)
  where parent_id is null;

do $$
begin
  if not exists (
    select 1
    from public.reference_items
    where parent_id is not null
    group by set_id, parent_id, lower(btrim(name))
    having count(*) > 1
  ) then
    create unique index if not exists reference_items_set_parent_name_uidx
      on public.reference_items (set_id, parent_id, lower(btrim(name)))
      where parent_id is not null;
  end if;

  if not exists (
    select 1
    from public.reference_items
    where parent_id is null
    group by set_id, lower(btrim(name))
    having count(*) > 1
  ) then
    create unique index if not exists reference_items_set_root_name_uidx
      on public.reference_items (set_id, lower(btrim(name)))
      where parent_id is null;
  end if;
end $$;

create or replace function public.allocate_reference_item_code(
  p_set_id uuid,
  p_parent_id uuid,
  p_desired_code text,
  p_exclude_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix integer;
begin
  base := lower(btrim(coalesce(p_desired_code, '')));
  if base !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  candidate := base;
  suffix := 2;
  while exists (
    select 1
    from public.reference_items i
    where i.set_id = p_set_id
      and i.parent_id is not distinct from p_parent_id
      and i.code = candidate
      and (p_exclude_id is null or i.id <> p_exclude_id)
  ) loop
    candidate := left(base, greatest(1, 64 - length('_' || suffix::text))) || '_' || suffix::text;
    suffix := suffix + 1;
    if suffix > 1000 then
      candidate := 'item_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      exit;
    end if;
  end loop;

  return candidate;
end;
$$;

drop function if exists public.upsert_reference_item(uuid, uuid, text, text, text, uuid);

create or replace function public.upsert_reference_item(
  target_id uuid,
  target_set_id uuid,
  item_code text,
  item_name text,
  item_description text default '',
  parent_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  normalized_name text;
  current_row public.reference_items%rowtype;
  result_id uuid;
  next_sort integer;
  requires_parent boolean;
  parent_set uuid;
begin
  perform public.assert_settings_write();

  select parent_set_id into parent_set
  from public.reference_sets
  where id = target_set_id;

  if not found then
    raise exception 'Справочник не найден.';
  end if;

  requires_parent := parent_set is not null;
  if requires_parent and parent_item_id is null then
    raise exception 'Укажите родителя записи.';
  end if;

  if parent_item_id is not null then
    if not exists (
      select 1
      from public.reference_items p
      where p.id = parent_item_id
        and p.set_id = parent_set
    ) then
      raise exception 'Родительская запись не найдена.';
    end if;
  end if;

  normalized_name := btrim(coalesce(item_name, ''));
  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if exists (
    select 1
    from public.reference_items i
    where i.set_id = target_set_id
      and i.parent_id is not distinct from parent_item_id
      and lower(btrim(i.name)) = lower(normalized_name)
      and (target_id is null or i.id <> target_id)
  ) then
    raise exception 'Запись с таким названием уже есть на этом уровне.';
  end if;

  if target_id is not null then
    select * into current_row from public.reference_items where id = target_id and set_id = target_set_id;
    if current_row.id is null then
      raise exception 'Запись справочника не найдена.';
    end if;

    if current_row.is_system then
      normalized_code := current_row.code;
    else
      normalized_code := public.allocate_reference_item_code(
        target_set_id,
        parent_item_id,
        item_code,
        target_id
      );
    end if;

    update public.reference_items
    set
      code = normalized_code,
      name = normalized_name,
      description = btrim(coalesce(item_description, '')),
      parent_id = parent_item_id
    where id = current_row.id
    returning id into result_id;
  else
    normalized_code := public.allocate_reference_item_code(
      target_set_id,
      parent_item_id,
      item_code,
      null
    );

    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.reference_items
    where set_id = target_set_id;

    insert into public.reference_items (set_id, parent_id, code, name, description, sort_order)
    values (
      target_set_id,
      parent_item_id,
      normalized_code,
      normalized_name,
      btrim(coalesce(item_description, '')),
      next_sort
    )
    returning id into result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'references.item_created' else 'references.item_updated' end,
    'reference_item',
    result_id::text,
    jsonb_build_object('set_id', target_set_id, 'code', normalized_code)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Запись с таким названием уже есть на этом уровне.';
end;
$$;

revoke all on function public.allocate_reference_item_code(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.upsert_reference_item(uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.upsert_reference_item(uuid, uuid, text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [65/73 | was 83/151] 20260829610000_order_list_total_amount.sql
-- -----------------------------------------------------------------------------

-- Итог заказа в списке: запчасти + работы.
-- Новую колонку можно только дописать в конец (CREATE OR REPLACE VIEW).
-- Суммы через security definer: у authenticated нет SELECT на order_service_lines.

drop view if exists public.order_list_items;
drop function if exists public.order_total_amount(uuid);

create function public.order_total_amount(target_order_id uuid)
returns numeric(14, 2)
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce(
      (select sum(l.quantity * l.unit_price) from public.order_part_lines l where l.order_id = target_order_id),
      0
    )
    + coalesce(
      (select sum(l.quantity * l.unit_price) from public.order_service_lines l where l.order_id = target_order_id),
      0
    )
  )::numeric(14, 2);
$$;

revoke all on function public.order_total_amount(uuid) from public, anon;
grant execute on function public.order_total_amount(uuid) to authenticated;

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
  coalesce(brand.name, '') as device_brand,
  coalesce(model.name, '') as device_model,
  public.device_display_name(grp.name, brand.name, model.name) as device_label,
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
  o.updated_at,
  public.order_total_amount(o.id)::numeric(14, 2) as total_amount
from public.orders o
join public.customers c on c.id = o.customer_id
join public.devices d on d.id = o.device_id
join public.reference_items st on st.id = o.status_id
left join public.order_status_meta meta on meta.status_id = o.status_id
left join public.profiles p on p.id = o.responsible_id
left join public.reference_items grp on grp.id = d.group_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id;

grant select on public.order_list_items to authenticated;

-- -----------------------------------------------------------------------------
-- [66/73 | was 84/151] 20260829620000_inventory_item_cover_photo.sql
-- -----------------------------------------------------------------------------

-- Обложка позиции в списке склада + RPC «сделать обложкой».

drop function if exists public.search_inventory_items(text, integer, integer, text);

create function public.search_inventory_items(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  stock_filter text default 'all'
)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint,
  cover_file_path text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  safe_page integer;
  safe_size integer;
  stock_value text;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('orders:read')
    or public.has_permission('sales:read')
    or public.has_permission('sales:create')
  ) then
    raise exception 'Недостаточно прав для просмотра склада.';
  end if;

  stock_value := coalesce(nullif(btrim(stock_filter), ''), 'all');
  if stock_value not in ('all', 'zero') then
    raise exception 'Неизвестный фильтр остатка.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  with stock as (
    select b.item_id, coalesce(sum(b.remaining_quantity), 0) as qty
    from public.inventory_batches b
    group by b.item_id
  )
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '') as category_name,
    i.unit_id,
    coalesce(u.name, '') as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    coalesce(stock.qty, 0) as stock_quantity,
    i.created_at,
    i.updated_at,
    count(*) over() as total_count,
    (
      select p.file_path
      from public.inventory_item_photos p
      where p.item_id = i.id
      order by p.sort_order, p.created_at
      limit 1
    ) as cover_file_path
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where (
      btrim(coalesce(search_query, '')) = ''
      or i.name ilike term escape '\'
      or i.code ilike term escape '\'
      or i.article ilike term escape '\'
      or i.barcode ilike term escape '\'
    )
    and (stock_value <> 'zero' or coalesce(stock.qty, 0) <= 0)
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.search_inventory_items(text, integer, integer, text) from public, anon;
grant execute on function public.search_inventory_items(text, integer, integer, text) to authenticated;

create or replace function public.set_inventory_item_photo_cover(target_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_item_photos%rowtype;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для изменения фото.';
  end if;

  select * into current_row
  from public.inventory_item_photos
  where id = target_photo_id
  for update;

  if not found then
    raise exception 'Фото не найдено.';
  end if;

  with ordered as (
    select
      p.id,
      row_number() over (
        order by
          case when p.id = target_photo_id then -1 else p.sort_order end,
          p.created_at
      ) - 1 as new_order
    from public.inventory_item_photos p
    where p.item_id = current_row.item_id
  )
  update public.inventory_item_photos p
  set sort_order = ordered.new_order
  from ordered
  where p.id = ordered.id;
end;
$$;

revoke all on function public.set_inventory_item_photo_cover(uuid) from public;
grant execute on function public.set_inventory_item_photo_cover(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [67/73 | was 85/151] 20260829630000_inventory_item_description.sql
-- -----------------------------------------------------------------------------

-- Описание позиции номенклатуры.

alter table public.inventory_items
  add column if not exists description text not null default '';

create or replace function public.create_inventory_item(
  item_name text,
  item_code text default '',
  item_article text default '',
  item_barcode text default '',
  item_category_id uuid default null,
  item_unit_id uuid default null,
  item_purchase_price numeric default 0,
  item_repair_price numeric default 0,
  item_retail_price numeric default 0,
  item_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_code text;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для создания номенклатуры.';
  end if;

  if btrim(coalesce(item_name, '')) = '' then
    raise exception 'Укажите наименование.';
  end if;

  if item_category_id is null then
    raise exception 'Выберите категорию.';
  end if;

  if item_unit_id is null then
    raise exception 'Выберите единицу измерения.';
  end if;

  perform public.assert_inventory_category(item_category_id);
  perform public.assert_inventory_unit(item_unit_id);

  if coalesce(item_purchase_price, 0) < 0 or coalesce(item_repair_price, 0) < 0 or coalesce(item_retail_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    next_code := 'N-' || lpad(nextval('public.inventory_item_code_seq')::text, 6, '0');
  end if;

  insert into public.inventory_items (
    code, article, barcode, name, description, category_id, unit_id, purchase_price, repair_price, retail_price
  )
  values (
    next_code,
    btrim(coalesce(item_article, '')),
    btrim(coalesce(item_barcode, '')),
    btrim(item_name),
    btrim(coalesce(item_description, '')),
    item_category_id,
    item_unit_id,
    coalesce(item_purchase_price, 0),
    coalesce(item_repair_price, 0),
    coalesce(item_retail_price, 0)
  )
  returning id into result_id;

  perform public.record_audit(
    'inventory.item_created',
    'inventory_item',
    result_id::text,
    jsonb_build_object('name', btrim(item_name), 'code', next_code)
  );

  return result_id;
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
    return null;
end;
$$;

create or replace function public.update_inventory_item(
  target_item_id uuid,
  item_name text,
  item_code text default '',
  item_article text default '',
  item_barcode text default '',
  item_category_id uuid default null,
  item_unit_id uuid default null,
  item_purchase_price numeric default 0,
  item_repair_price numeric default 0,
  item_retail_price numeric default 0,
  item_description text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_code text;
  clean_name text := btrim(coalesce(item_name, ''));
  clean_repair numeric := coalesce(item_repair_price, 0);
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для изменения номенклатуры.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if item_category_id is null or item_unit_id is null then
    raise exception 'Категория и единица измерения обязательны.';
  end if;

  perform public.assert_inventory_category(item_category_id);
  perform public.assert_inventory_unit(item_unit_id);

  if coalesce(item_purchase_price, 0) < 0 or clean_repair < 0 or coalesce(item_retail_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    select code into next_code from public.inventory_items where id = target_item_id;
  end if;

  update public.inventory_items
  set
    code = next_code,
    article = btrim(coalesce(item_article, '')),
    barcode = btrim(coalesce(item_barcode, '')),
    name = clean_name,
    description = btrim(coalesce(item_description, '')),
    category_id = item_category_id,
    unit_id = item_unit_id,
    purchase_price = coalesce(item_purchase_price, 0),
    repair_price = clean_repair,
    retail_price = coalesce(item_retail_price, 0)
  where id = target_item_id;

  update public.order_part_lines
  set
    name = clean_name,
    unit_price = clean_repair
  where item_id = target_item_id;

  perform public.record_audit(
    'inventory.item_updated',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', clean_name, 'code', next_code)
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
end;
$$;

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'barcode_type', i.barcode_type,
    'name', i.name,
    'description', i.description,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          rec.supplier_id,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        left join public.inventory_receipts rec on rec.id = bt.receipt_id
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        select
          m.id,
          m.quantity,
          m.unit_price,
          m.movement_type,
          m.reference_type,
          m.reference_id,
          m.created_at,
          m.batch_id,
          bt.receipt_date as batch_receipt_date,
          bt.supplier as batch_supplier,
          coalesce(p.full_name, '') as actor_name,
          case m.reference_type
            when 'order' then 'Заказ ' || coalesce(o.number, '')
            when 'receipt' then 'Приход · ' || coalesce(r.supplier, '')
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа · счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- [68/73 | was 86/151] 20260829640000_settle_shortage_on_receive.sql
-- -----------------------------------------------------------------------------

-- Недостача: остаток партии = сумма движений (отрицательный долг).
-- Приход сначала покрывает долг, затем увеличивает доступный остаток.
-- Карточка и список считают остаток одинаково — по remaining_quantity.

alter table public.inventory_batches
  drop constraint if exists inventory_batches_remaining_check;

alter table public.inventory_batches
  add constraint inventory_batches_remaining_check check (
    remaining_quantity <= quantity
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_type_check check (
    movement_type in (
      'receipt',
      'repair_consumption',
      'repair_return',
      'sale',
      'inventory_adjustment',
      'shortage_cover'
    )
  );

-- Старые партии «Недостача»: rem был 0 при движениях −N (фантом). Выравниваем rem = Σ движений.
update public.inventory_batches b
set remaining_quantity = coalesce((
  select sum(m.quantity)
  from public.inventory_movements m
  where m.batch_id = b.id
), 0)
where b.supplier = 'Недостача'
  and b.remaining_quantity is distinct from coalesce((
    select sum(m.quantity)
    from public.inventory_movements m
    where m.batch_id = b.id
  ), 0);

create or replace function public.settle_inventory_shortage(
  target_item_id uuid,
  source_batch_id uuid,
  target_receipt_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  short public.inventory_batches%rowtype;
  source_rem numeric;
  need numeric;
  take numeric;
  covered numeric := 0;
begin
  if target_item_id is null or source_batch_id is null or target_receipt_id is null then
    return 0;
  end if;

  perform 1
  from public.inventory_batches
  where item_id = target_item_id
  for update;

  select remaining_quantity into source_rem
  from public.inventory_batches
  where id = source_batch_id
    and item_id = target_item_id;

  if source_rem is null or source_rem <= 0 then
    return 0;
  end if;

  for short in
    select *
    from public.inventory_batches
    where item_id = target_item_id
      and remaining_quantity < 0
    order by receipt_date asc, created_at asc, id asc
    for update
  loop
    select remaining_quantity into source_rem
    from public.inventory_batches
    where id = source_batch_id;

    exit when source_rem is null or source_rem <= 0;

    need := -short.remaining_quantity;
    take := least(need, source_rem);
    exit when take <= 0;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      short.id,
      take,
      0,
      'shortage_cover',
      'receipt',
      target_receipt_id,
      auth.uid()
    );

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      source_batch_id,
      -take,
      (
        select purchase_price
        from public.inventory_batches
        where id = source_batch_id
      ),
      'shortage_cover',
      'receipt',
      target_receipt_id,
      auth.uid()
    );

    covered := covered + take;
  end loop;

  return covered;
end;
$$;

revoke all on function public.settle_inventory_shortage(uuid, uuid, uuid) from public, anon;
grant execute on function public.settle_inventory_shortage(uuid, uuid, uuid) to authenticated;

-- Покрыть уже существующий долг текущими положительными партиями (FIFO).
do $$
declare
  item_rec record;
  batch_rec record;
begin
  for item_rec in
    select distinct item_id
    from public.inventory_batches
    where remaining_quantity < 0
  loop
    for batch_rec in
      select id
      from public.inventory_batches
      where item_id = item_rec.item_id
        and remaining_quantity > 0
        and receipt_id is not null
      order by receipt_date asc, created_at asc, id asc
    loop
      perform public.settle_inventory_shortage(
        item_rec.item_id,
        batch_rec.id,
        (
          select receipt_id
          from public.inventory_batches
          where id = batch_rec.id
        )
      );
    end loop;
  end loop;
end;
$$;

create or replace function public.consume_inventory_fifo(
  target_item_id uuid,
  consume_quantity numeric,
  target_movement_type text,
  target_reference_type text,
  target_reference_id uuid,
  allow_shortage boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  available numeric;
  remaining numeric;
  take numeric;
  batch_row public.inventory_batches%rowtype;
  shortage_batch_id uuid;
  movement_id uuid;
  lines jsonb := '[]'::jsonb;
begin
  if consume_quantity is null or consume_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  perform 1
  from public.inventory_batches
  where item_id = target_item_id
  for update;

  select coalesce(sum(remaining_quantity), 0)
    into available
  from public.inventory_batches
  where item_id = target_item_id;

  if available < consume_quantity and not coalesce(allow_shortage, false) then
    raise exception 'Недостаточно остатка. Доступно: %, запрошено: %.', available, consume_quantity;
  end if;

  remaining := consume_quantity;

  for batch_row in
    select *
    from public.inventory_batches
    where item_id = target_item_id
      and remaining_quantity > 0
    order by receipt_date asc, created_at asc, id asc
    for update
  loop
    exit when remaining <= 0;

    take := least(batch_row.remaining_quantity, remaining);

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      batch_row.id,
      -take,
      batch_row.purchase_price,
      target_movement_type,
      target_reference_type,
      target_reference_id,
      auth.uid()
    )
    returning id into movement_id;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'movement_id', movement_id,
      'batch_id', batch_row.id,
      'quantity', take,
      'unit_price', batch_row.purchase_price,
      'receipt_date', batch_row.receipt_date
    ));

    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    if not coalesce(allow_shortage, false) then
      raise exception 'Недостаточно остатка.';
    end if;

    insert into public.inventory_batches (
      item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
    )
    values (
      target_item_id,
      null,
      'Недостача',
      current_date,
      0,
      remaining,
      0
    )
    returning id into shortage_batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      shortage_batch_id,
      -remaining,
      0,
      target_movement_type,
      target_reference_type,
      target_reference_id,
      auth.uid()
    )
    returning id into movement_id;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'movement_id', movement_id,
      'batch_id', shortage_batch_id,
      'quantity', remaining,
      'unit_price', 0,
      'receipt_date', current_date,
      'shortage', true
    ));

    remaining := 0;
  end if;

  return jsonb_build_object(
    'item_id', target_item_id,
    'quantity', consume_quantity,
    'lines', lines
  );
end;
$$;

create or replace function public.receive_inventory(
  supplier_name text,
  doc_receipt_date date,
  doc_notes text,
  lines jsonb,
  supplier_customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_id uuid;
  line record;
  batch_id uuid;
  line_count integer := 0;
  resolved_name text;
  resolved_supplier_id uuid;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для прихода.';
  end if;

  resolved_supplier_id := supplier_customer_id;
  resolved_name := btrim(coalesce(supplier_name, ''));

  if resolved_supplier_id is not null then
    select c.name into resolved_name
    from public.customers c
    where c.id = resolved_supplier_id;

    if resolved_name is null then
      raise exception 'Поставщик не найден.';
    end if;
  elsif resolved_name = '' then
    raise exception 'Укажите поставщика.';
  else
    select c.id
    into resolved_supplier_id
    from public.customers c
    where lower(btrim(c.name)) = lower(resolved_name)
    order by c.created_at
    limit 1;
  end if;

  if doc_receipt_date is null then
    raise exception 'Укажите дату прихода.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(lines, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  insert into public.inventory_receipts (supplier, supplier_id, receipt_date, notes, created_by)
  values (resolved_name, resolved_supplier_id, doc_receipt_date, btrim(coalesce(doc_notes, '')), auth.uid())
  returning id into receipt_id;

  for line in
    select *
    from jsonb_to_recordset(lines) as x(
      item_id uuid,
      quantity numeric,
      purchase_price numeric
    )
  loop
    line_count := line_count + 1;

    if line.item_id is null then
      raise exception 'В строке прихода не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция прихода не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 then
      raise exception 'Количество в приходе должно быть больше нуля.';
    end if;

    if line.purchase_price is null or line.purchase_price < 0 then
      raise exception 'Цена закупки не может быть отрицательной.';
    end if;

    perform pg_advisory_xact_lock(871001, hashtext(line.item_id::text));

    insert into public.inventory_batches (
      item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
    )
    values (
      line.item_id,
      receipt_id,
      resolved_name,
      doc_receipt_date,
      line.purchase_price,
      line.quantity,
      0
    )
    returning id into batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      line.item_id,
      batch_id,
      line.quantity,
      line.purchase_price,
      'receipt',
      'receipt',
      receipt_id,
      auth.uid()
    );

    perform public.settle_inventory_shortage(line.item_id, batch_id, receipt_id);
  end loop;

  if line_count = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  perform public.record_audit(
    'inventory.received',
    'inventory_receipt',
    receipt_id::text,
    jsonb_build_object('supplier', resolved_name, 'lines', line_count)
  );

  return receipt_id;
end;
$$;

create or replace function public.find_inventory_items_by_barcode(barcode_query text)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  code_value text;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('sales:read')
    or public.has_permission('sales:create')
  ) then
    raise exception 'Недостаточно прав для поиска по штрихкоду.';
  end if;

  code_value := btrim(coalesce(barcode_query, ''));
  if code_value = '' then
    return;
  end if;

  return query
  with stock as (
    select b.item_id, coalesce(sum(b.remaining_quantity), 0) as qty
    from public.inventory_batches b
    group by b.item_id
  )
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '') as category_name,
    i.unit_id,
    coalesce(u.name, '') as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    coalesce(stock.qty, 0) as stock_quantity,
    i.created_at,
    i.updated_at,
    count(*) over() as total_count
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where i.barcode = code_value
     or i.code = code_value
  order by i.name
  limit 20;
end;
$$;

create or replace function public.delete_inventory_receipt(
  target_receipt_id uuid,
  delete_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_receipts%rowtype;
  movement_row record;
  cover_row record;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления прихода.';
  end if;

  select *
    into current_row
  from public.inventory_receipts
  where id = target_receipt_id
  for update;

  if not found then
    raise exception 'Приход не найден.';
  end if;

  if current_row.reversed_at is not null then
    raise exception 'Приход уже отменён.';
  end if;

  if delete_mode = 'hide' then
    if current_row.hidden_at is not null then
      raise exception 'Приход уже скрыт.';
    end if;

    update public.inventory_receipts
    set hidden_at = now()
    where id = target_receipt_id;

    perform public.record_audit(
      'inventory.receipt_hidden',
      'inventory_receipt',
      target_receipt_id::text,
      jsonb_build_object('supplier', current_row.supplier)
    );

    return;
  end if;

  if delete_mode <> 'reverse' then
    raise exception 'Неверный режим удаления прихода.';
  end if;

  -- Сначала откатываем покрытие недостачи этим приходом (возвращаем qty на партии прихода).
  for cover_row in
    select
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price
    from public.inventory_movements m
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'shortage_cover'
    order by m.created_at desc, m.id desc
  loop
    perform pg_advisory_xact_lock(871001, hashtext(cover_row.item_id::text));

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      cover_row.item_id,
      cover_row.batch_id,
      -cover_row.quantity,
      cover_row.unit_price,
      'shortage_cover',
      'receipt',
      target_receipt_id,
      auth.uid()
    );
  end loop;

  for movement_row in
    select
      m.id,
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price,
      b.remaining_quantity
    from public.inventory_movements m
    join public.inventory_batches b on b.id = m.batch_id
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'receipt'
    order by m.created_at, m.id
  loop
    if movement_row.remaining_quantity < movement_row.quantity then
      raise exception 'Нельзя отменить приход: часть позиций уже списана.';
    end if;
  end loop;

  for movement_row in
    select
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price
    from public.inventory_movements m
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'receipt'
    order by m.created_at, m.id
  loop
    perform pg_advisory_xact_lock(871001, hashtext(movement_row.item_id::text));

    insert into public.inventory_movements (
      item_id,
      batch_id,
      quantity,
      unit_price,
      movement_type,
      reference_type,
      reference_id,
      created_by
    )
    values (
      movement_row.item_id,
      movement_row.batch_id,
      -movement_row.quantity,
      movement_row.unit_price,
      'inventory_adjustment',
      'receipt',
      target_receipt_id,
      auth.uid()
    );
  end loop;

  update public.inventory_receipts
  set hidden_at = coalesce(hidden_at, now()),
      reversed_at = now()
  where id = target_receipt_id;

  perform public.record_audit(
    'inventory.receipt_reversed',
    'inventory_receipt',
    target_receipt_id::text,
    jsonb_build_object('supplier', current_row.supplier)
  );
end;
$$;

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'barcode_type', i.barcode_type,
    'name', i.name,
    'description', i.description,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(b.remaining_quantity) from public.inventory_batches b where b.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          rec.supplier_id,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        left join public.inventory_receipts rec on rec.id = bt.receipt_id
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        select
          m.id,
          m.quantity,
          m.unit_price,
          m.movement_type,
          m.reference_type,
          m.reference_id,
          m.created_at,
          m.batch_id,
          bt.receipt_date as batch_receipt_date,
          bt.supplier as batch_supplier,
          coalesce(p.full_name, '') as actor_name,
          case m.reference_type
            when 'order' then 'Заказ ' || coalesce(o.number, '')
            when 'receipt' then
              case
                when m.movement_type = 'shortage_cover' then 'Покрытие недостачи · ' || coalesce(r.supplier, '')
                else 'Приход · ' || coalesce(r.supplier, '')
              end
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа · счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- [69/73 | was 87/151] 20260829650000_date_display_dd_mm_yy.sql
-- -----------------------------------------------------------------------------

-- Даты в уведомлениях о сроке — как в UI: дд.мм.гг

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
            'body', 'Срок заказа ' || rec.number || ' — ' || to_char(rec.deadline, 'DD.MM.YY') || '.'
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

-- -----------------------------------------------------------------------------
-- [70/73 | was 88/151] 20260829660000_order_work_field_entity.sql
-- -----------------------------------------------------------------------------

-- Раздел полей карточек «Состав работы» (значения хранятся на заказе).

insert into public.field_entities (code, name, description, sort_order)
values (
  'order_work',
  'Состав работы',
  'Дополнительные поля вкладки «Состав работы» в заказе',
  1
)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- Сдвинуть остальные разделы после заказов / состава работы.
update public.field_entities set sort_order = 2 where code = 'customers';
update public.field_entities set sort_order = 3 where code = 'devices';
update public.field_entities set sort_order = 4 where code = 'diagnostics';
update public.field_entities set sort_order = 5 where code = 'inventory';
update public.field_entities set sort_order = 6 where code = 'tasks';

-- -----------------------------------------------------------------------------
-- [71/73 | was 89/151] 20260829670000_fix_order_list_total_privs.sql
-- -----------------------------------------------------------------------------

-- order_list_items с security_invoker не может читать order_service_lines
-- (у authenticated revoke all). Итог считаем через security definer.

drop view if exists public.order_list_items;
drop function if exists public.order_total_amount(uuid);

create function public.order_total_amount(target_order_id uuid)
returns numeric(14, 2)
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce(
      (select sum(l.quantity * l.unit_price) from public.order_part_lines l where l.order_id = target_order_id),
      0
    )
    + coalesce(
      (select sum(l.quantity * l.unit_price) from public.order_service_lines l where l.order_id = target_order_id),
      0
    )
  )::numeric(14, 2);
$$;

revoke all on function public.order_total_amount(uuid) from public, anon;
grant execute on function public.order_total_amount(uuid) to authenticated;

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
  coalesce(brand.name, '') as device_brand,
  coalesce(model.name, '') as device_model,
  public.device_display_name(grp.name, brand.name, model.name) as device_label,
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
  o.updated_at,
  public.order_total_amount(o.id)::numeric(14, 2) as total_amount
from public.orders o
join public.customers c on c.id = o.customer_id
join public.devices d on d.id = o.device_id
join public.reference_items st on st.id = o.status_id
left join public.order_status_meta meta on meta.status_id = o.status_id
left join public.profiles p on p.id = o.responsible_id
left join public.reference_items grp on grp.id = d.group_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id;

grant select on public.order_list_items to authenticated;

-- -----------------------------------------------------------------------------
-- [72/73 | was 90/151] 20260829680000_device_display_name_spaces.sql
-- -----------------------------------------------------------------------------

-- Названия приборов: части через пробел, без средней точки.

create or replace function public.device_display_name(group_name text, brand_name text, model_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      concat_ws(
        ' ',
        nullif(btrim(coalesce(group_name, '')), ''),
        nullif(btrim(coalesce(brand_name, '')), ''),
        nullif(btrim(coalesce(model_name, '')), '')
      ),
      ''
    ),
    'Прибор'
  );
$$;

-- -----------------------------------------------------------------------------
-- [73/73 | was 91/151] 20260829690000_inventory_write_offs.sql
-- -----------------------------------------------------------------------------

-- Документы списания со склада: список, проведение FIFO, отмена.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_type_check check (
    movement_type in (
      'receipt',
      'repair_consumption',
      'repair_return',
      'sale',
      'inventory_adjustment',
      'shortage_cover',
      'write_off'
    )
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_reference_check;

alter table public.inventory_movements
  add constraint inventory_movements_reference_check check (
    reference_type in (
      'receipt',
      'order',
      'sale',
      'inventory_adjustment',
      'inventory_count',
      'inventory_write_off'
    )
  );

create table if not exists public.inventory_write_offs (
  id uuid primary key default gen_random_uuid(),
  write_off_date date not null,
  reason text not null,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  reversed_at timestamptz,
  constraint inventory_write_offs_reason_present check (btrim(reason) <> '')
);

create index if not exists inventory_write_offs_created_at_idx
  on public.inventory_write_offs (created_at desc);

create index if not exists inventory_write_offs_hidden_at_idx
  on public.inventory_write_offs (hidden_at)
  where hidden_at is null;

alter table public.inventory_write_offs enable row level security;

drop policy if exists inventory_write_offs_select on public.inventory_write_offs;
create policy inventory_write_offs_select
  on public.inventory_write_offs
  for select
  to authenticated
  using (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  );

create or replace function public.create_inventory_write_off(
  doc_write_off_date date,
  reason_text text,
  notes_text text,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  write_off_id uuid;
  line record;
  line_count integer := 0;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания.';
  end if;

  if doc_write_off_date is null then
    raise exception 'Укажите дату списания.';
  end if;

  if btrim(coalesce(reason_text, '')) = '' then
    raise exception 'Укажите причину списания.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(lines, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте хотя бы одну позицию списания.';
  end if;

  insert into public.inventory_write_offs (write_off_date, reason, notes, created_by)
  values (
    doc_write_off_date,
    btrim(reason_text),
    btrim(coalesce(notes_text, '')),
    auth.uid()
  )
  returning id into write_off_id;

  for line in
    select *
    from jsonb_to_recordset(lines) as x(
      item_id uuid,
      quantity numeric
    )
  loop
    line_count := line_count + 1;

    if line.item_id is null then
      raise exception 'В строке списания не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция списания не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 then
      raise exception 'Количество в списании должно быть больше нуля.';
    end if;

    perform public.consume_inventory_fifo(
      line.item_id,
      line.quantity,
      'write_off',
      'inventory_write_off',
      write_off_id,
      false
    );
  end loop;

  if line_count = 0 then
    raise exception 'Добавьте хотя бы одну позицию списания.';
  end if;

  perform public.record_audit(
    'inventory.write_off_created',
    'inventory_write_off',
    write_off_id::text,
    jsonb_build_object('reason', btrim(reason_text), 'lines', line_count)
  );

  return write_off_id;
end;
$$;

create or replace function public.list_inventory_write_offs(
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  write_off_date date,
  reason text,
  notes text,
  created_at timestamptz,
  actor_name text,
  line_count bigint,
  total_quantity numeric,
  total_amount numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_page integer;
  safe_size integer;
begin
  if not (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для просмотра списаний.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    w.id,
    w.write_off_date,
    w.reason,
    w.notes,
    w.created_at,
    coalesce(p.full_name, '') as actor_name,
    count(distinct m.item_id) as line_count,
    coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0) as total_quantity,
    coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0) as total_amount,
    count(*) over() as total_count
  from public.inventory_write_offs w
  left join public.profiles p on p.id = w.created_by
  left join public.inventory_movements m
    on m.reference_type = 'inventory_write_off'
   and m.reference_id = w.id
   and m.movement_type = 'write_off'
  where w.hidden_at is null
    and w.reversed_at is null
  group by w.id, w.write_off_date, w.reason, w.notes, w.created_at, p.full_name
  order by w.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_inventory_write_off(target_write_off_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для просмотра списания.';
  end if;

  select jsonb_build_object(
    'id', w.id,
    'write_off_date', w.write_off_date,
    'reason', w.reason,
    'notes', w.notes,
    'created_at', w.created_at,
    'actor_name', coalesce(p.full_name, ''),
    'reversed_at', w.reversed_at,
    'lines', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.item_name)
      from (
        select
          min(m.id::text) as id,
          m.item_id,
          i.name as item_name,
          i.code as item_code,
          i.article as item_article,
          coalesce(u.name, '') as unit_name,
          sum(-m.quantity) as quantity,
          case
            when sum(-m.quantity) = 0 then 0
            else sum((-m.quantity) * m.unit_price) / nullif(sum(-m.quantity), 0)
          end as unit_price,
          sum((-m.quantity) * m.unit_price) as amount
        from public.inventory_movements m
        join public.inventory_items i on i.id = m.item_id
        left join public.reference_items u on u.id = i.unit_id
        where m.reference_type = 'inventory_write_off'
          and m.reference_id = target_write_off_id
          and m.movement_type = 'write_off'
          and m.quantity < 0
        group by m.item_id, i.name, i.code, i.article, u.name
      ) x
    ), '[]'::jsonb)
  )
  into result
  from public.inventory_write_offs w
  left join public.profiles p on p.id = w.created_by
  where w.id = target_write_off_id
    and w.hidden_at is null;

  return result;
end;
$$;

create or replace function public.delete_inventory_write_off(
  target_write_off_id uuid,
  delete_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_write_offs%rowtype;
  movement_row record;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для удаления списания.';
  end if;

  select *
    into current_row
  from public.inventory_write_offs
  where id = target_write_off_id
  for update;

  if not found then
    raise exception 'Списание не найдено.';
  end if;

  if current_row.reversed_at is not null then
    raise exception 'Списание уже отменено.';
  end if;

  if delete_mode = 'hide' then
    if current_row.hidden_at is not null then
      raise exception 'Списание уже скрыто.';
    end if;

    update public.inventory_write_offs
    set hidden_at = now()
    where id = target_write_off_id;

    perform public.record_audit(
      'inventory.write_off_hidden',
      'inventory_write_off',
      target_write_off_id::text,
      jsonb_build_object('reason', current_row.reason)
    );

    return;
  end if;

  if delete_mode <> 'reverse' then
    raise exception 'Неверный режим удаления списания.';
  end if;

  for movement_row in
    select
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price
    from public.inventory_movements m
    where m.reference_type = 'inventory_write_off'
      and m.reference_id = target_write_off_id
      and m.movement_type = 'write_off'
      and m.quantity < 0
    order by m.created_at, m.id
  loop
    perform pg_advisory_xact_lock(871001, hashtext(movement_row.item_id::text));

    insert into public.inventory_movements (
      item_id,
      batch_id,
      quantity,
      unit_price,
      movement_type,
      reference_type,
      reference_id,
      created_by
    )
    values (
      movement_row.item_id,
      movement_row.batch_id,
      -movement_row.quantity,
      movement_row.unit_price,
      'write_off',
      'inventory_write_off',
      target_write_off_id,
      auth.uid()
    );
  end loop;

  update public.inventory_write_offs
  set hidden_at = coalesce(hidden_at, now()),
      reversed_at = now()
  where id = target_write_off_id;

  perform public.record_audit(
    'inventory.write_off_reversed',
    'inventory_write_off',
    target_write_off_id::text,
    jsonb_build_object('reason', current_row.reason)
  );
end;
$$;

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'barcode_type', i.barcode_type,
    'name', i.name,
    'description', i.description,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(b.remaining_quantity) from public.inventory_batches b where b.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          rec.supplier_id,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        left join public.inventory_receipts rec on rec.id = bt.receipt_id
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        select
          m.id,
          m.quantity,
          m.unit_price,
          m.movement_type,
          m.reference_type,
          m.reference_id,
          m.created_at,
          m.batch_id,
          bt.receipt_date as batch_receipt_date,
          bt.supplier as batch_supplier,
          coalesce(p.full_name, '') as actor_name,
          case m.reference_type
            when 'order' then 'Заказ ' || coalesce(o.number, '')
            when 'receipt' then
              case
                when m.movement_type = 'shortage_cover' then 'Покрытие недостачи ' || coalesce(r.supplier, '')
                else 'Приход ' || coalesce(r.supplier, '')
              end
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация ' || coalesce(a.reason, '')
            when 'inventory_write_off' then
              case
                when m.quantity > 0 then 'Отмена списания ' || coalesce(w.reason, '')
                else 'Списание ' || coalesce(w.reason, '')
              end
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        left join public.inventory_write_offs w on m.reference_type = 'inventory_write_off' and w.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_inventory_write_off(date, text, text, jsonb) from public;
revoke all on function public.list_inventory_write_offs(integer, integer) from public;
revoke all on function public.get_inventory_write_off(uuid) from public;
revoke all on function public.delete_inventory_write_off(uuid, text) from public;

grant execute on function public.create_inventory_write_off(date, text, text, jsonb) to authenticated;
grant execute on function public.list_inventory_write_offs(integer, integer) to authenticated;
grant execute on function public.get_inventory_write_off(uuid) to authenticated;
grant execute on function public.delete_inventory_write_off(uuid, text) to authenticated;

