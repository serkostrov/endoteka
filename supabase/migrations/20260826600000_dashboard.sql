-- Операционный рабочий стол и фильтр нулевого остатка для перехода со сводки.

drop function if exists public.search_inventory_items(text, integer, integer);
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
    select m.item_id, coalesce(sum(m.quantity), 0) as qty
    from public.inventory_movements m
    group by m.item_id
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
  result jsonb;
begin
  if not public.has_permission('dashboard:read') then
    raise exception 'Недостаточно прав.';
  end if;

  result := jsonb_build_object(
    'can_orders', can_orders,
    'can_tasks', can_tasks,
    'can_inventory', can_inventory,
    'can_notifications', can_notifications,
    'can_diagnostics', public.has_permission('diagnostics:read')
  );

  if can_orders then
    result := result || jsonb_build_object(
      'orders', jsonb_build_object(
        'active', (select count(*) from public.order_list_items where not is_terminal),
        'attention', (
          select count(*) from public.order_list_items
          where not is_terminal
            and (
              deadline_state in ('overdue', 'approaching')
              or status_code = 'waiting_approval'
            )
        ),
        'overdue', (
          select count(*) from public.order_list_items
          where not is_terminal and deadline_state = 'overdue'
        ),
        'approaching', (
          select count(*) from public.order_list_items
          where not is_terminal and deadline_state = 'approaching'
        ),
        'waiting_approval', (
          select count(*) from public.order_list_items
          where not is_terminal and status_code = 'waiting_approval'
        ),
        'repair', (
          select count(*) from public.order_list_items
          where not is_terminal and status_code = 'repair'
        ),
        'diagnostics', (
          select count(*) from public.order_list_items
          where not is_terminal and status_code = 'diagnostics'
        ),
        'mine_active', (
          select count(*) from public.order_list_items
          where not is_terminal and responsible_id = auth.uid()
        ),
        'mine_overdue', (
          select count(*) from public.order_list_items
          where not is_terminal and responsible_id = auth.uid() and deadline_state = 'overdue'
        ),
        'mine_diagnostics', (
          select count(*) from public.order_list_items
          where not is_terminal and responsible_id = auth.uid() and status_code = 'diagnostics'
        ),
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
            from public.order_list_items
            where not is_terminal and deadline_state = 'overdue'
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
            from public.order_list_items
            where not is_terminal and responsible_id = auth.uid()
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
            from public.order_list_items
            where not is_terminal and status_code = 'repair'
            order by updated_at desc
            limit 5
          ) o
        )
      )
    );
  end if;

  if can_tasks then
    result := result || jsonb_build_object(
      'tasks', jsonb_build_object(
        'open', (select count(*) from public.tasks where not completed),
        'mine_open', (select count(*) from public.tasks where not completed and assignee_id = auth.uid()),
        'mine_today', (
          select count(*) from public.tasks
          where not completed and assignee_id = auth.uid() and due_date = current_date
        ),
        'mine_overdue', (
          select count(*) from public.tasks
          where not completed and assignee_id = auth.uid() and due_date is not null and due_date < current_date
        ),
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
    );
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
          select count(*) from (
            select i.id, coalesce(sum(m.quantity), 0) as qty
            from public.inventory_items i
            left join public.inventory_movements m on m.item_id = i.id
            group by i.id
          ) s
          where s.qty <= 0
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
            select i.id, i.name, i.code, coalesce(sum(m.quantity), 0) as qty
            from public.inventory_items i
            left join public.inventory_movements m on m.item_id = i.id
            group by i.id, i.name, i.code
            having coalesce(sum(m.quantity), 0) <= 0
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

revoke all on function public.search_inventory_items(text, integer, integer, text) from public, anon;
revoke all on function public.get_operational_dashboard() from public, anon;

grant execute on function public.search_inventory_items(text, integer, integer, text) to authenticated;
grant execute on function public.get_operational_dashboard() to authenticated;
