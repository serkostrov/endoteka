-- Постоянный товар: фильтр «Нет остатка» только для регулярных позиций.

alter table public.inventory_items
  add column if not exists is_permanent boolean not null default true;

comment on column public.inventory_items.is_permanent is
  'Постоянный товар: при нулевом остатке попадает в фильтр «Нет остатка».';

drop function if exists public.create_inventory_item(text, text, text, text, uuid, uuid, numeric, numeric, numeric);
drop function if exists public.create_inventory_item(text, text, text, text, uuid, uuid, numeric, numeric, numeric, text);

drop function if exists public.update_inventory_item(uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric);
drop function if exists public.update_inventory_item(uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text);

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
  item_description text default '',
  item_is_permanent boolean default true
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
    code, article, barcode, name, description, category_id, unit_id,
    purchase_price, repair_price, retail_price, is_permanent
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
    coalesce(item_retail_price, 0),
    coalesce(item_is_permanent, true)
  )
  returning id into result_id;

  perform public.record_audit(
    'inventory.item_created',
    'inventory_item',
    result_id::text,
    jsonb_build_object('name', btrim(item_name), 'code', next_code, 'is_permanent', coalesce(item_is_permanent, true))
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
  item_description text default '',
  item_is_permanent boolean default true
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
  permanent boolean := coalesce(item_is_permanent, true);
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
    retail_price = coalesce(item_retail_price, 0),
    is_permanent = permanent
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
    jsonb_build_object('name', clean_name, 'code', next_code, 'is_permanent', permanent)
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
    'is_permanent', i.is_permanent,
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
        with raw as (
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
                  when m.movement_type = 'shortage_cover' then 'Покрытие недостачи'
                  else 'Оприходование'
                end
              when 'sale' then
                'Продажа ' || coalesce(nullif(sa.invoice_number, ''), nullif(legacy.invoice_number, ''), '')
              when 'inventory_adjustment' then 'Инвентаризация'
              when 'inventory_count' then 'Инвентаризация ' || coalesce(c.number, '')
              when 'inventory_write_off' then
                case
                  when m.quantity > 0 then 'Отмена списания'
                  else 'Списание'
                end
              else coalesce(m.reference_type, 'Движение')
            end as document_title,
            case m.reference_type
              when 'order' then coalesce(oc.name, '')
              when 'sale' then coalesce(sc.name, '')
              when 'receipt' then coalesce(r.supplier, bt.supplier, '')
              when 'inventory_adjustment' then coalesce(a.reason, '')
              when 'inventory_write_off' then coalesce(w.reason, '')
              else ''
            end as counterparty_name,
            case m.reference_type
              when 'order' then
                case
                  when m.quantity < 0 then 'Со склада · Добавлено в заказ клиенту'
                  else 'Возврат на склад из заказа'
                end
              when 'sale' then 'Со склада · Продажа клиенту'
              when 'receipt' then
                case
                  when m.movement_type = 'shortage_cover' then 'Покрытие недостачи от поставщика'
                  else 'От поставщика на склад'
                end
              when 'inventory_adjustment' then 'Корректировка остатка'
              when 'inventory_count' then 'Пересчёт склада'
              when 'inventory_write_off' then
                case
                  when m.quantity > 0 then 'Возврат на склад после отмены списания'
                  else 'Списание со склада'
                end
              else ''
            end as description_prefix
          from public.inventory_movements m
          join public.inventory_batches bt on bt.id = m.batch_id
          left join public.profiles p on p.id = m.created_by
          left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
          left join public.customers oc on oc.id = o.customer_id
          left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
          left join public.sales sa on m.reference_type = 'sale' and sa.id = m.reference_id
          left join public.customers sc on sc.id = sa.customer_id
          left join public.inventory_sales legacy on m.reference_type = 'sale' and legacy.id = m.reference_id
          left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
          left join public.inventory_write_offs w on m.reference_type = 'inventory_write_off' and w.id = m.reference_id
          left join public.inventory_counts c on m.reference_type = 'inventory_count' and c.id = m.reference_id
          where m.item_id = target_item_id
        )
        select
          (array_agg(raw.id order by raw.created_at desc))[1] as id,
          sum(raw.quantity) as quantity,
          (array_agg(raw.unit_price order by raw.created_at desc))[1] as unit_price,
          raw.movement_type,
          raw.reference_type,
          raw.reference_id,
          max(raw.created_at) as created_at,
          (array_agg(raw.batch_id order by raw.created_at desc))[1] as batch_id,
          (array_agg(raw.batch_receipt_date order by raw.created_at desc))[1] as batch_receipt_date,
          (array_agg(raw.batch_supplier order by raw.created_at desc))[1] as batch_supplier,
          (array_agg(raw.actor_name order by raw.created_at desc))[1] as actor_name,
          (array_agg(raw.document_title order by raw.created_at desc))[1] as document_title,
          (array_agg(raw.counterparty_name order by raw.created_at desc))[1] as counterparty_name,
          (array_agg(raw.description_prefix order by raw.created_at desc))[1] as description_prefix,
          (array_agg(raw.document_title order by raw.created_at desc))[1] as destination
        from raw
        group by raw.reference_type, raw.reference_id, raw.movement_type
        order by max(raw.created_at) desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;


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
  if stock_value not in ('all', 'zero', 'in_stock') then
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
    and (stock_value <> 'zero' or (coalesce(stock.qty, 0) <= 0 and i.is_permanent))
    and (stock_value <> 'in_stock' or coalesce(stock.qty, 0) > 0)
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.search_inventory_items(text, integer, integer, text) from public, anon;
grant execute on function public.search_inventory_items(text, integer, integer, text) to authenticated;


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
          where i.is_permanent
            and not exists (
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
            where i.is_permanent
              and not exists (
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

revoke all on function public.create_inventory_item(text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean) from public, anon;
revoke all on function public.update_inventory_item(uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean) from public, anon;
grant execute on function public.create_inventory_item(text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean) to authenticated;
grant execute on function public.update_inventory_item(uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean) to authenticated;

