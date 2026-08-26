-- Эндотека: документы инвентаризации. Расхождения проводятся только журналом движений.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_reference_check;

alter table public.inventory_movements
  add constraint inventory_movements_reference_check check (
    reference_type in ('receipt', 'order', 'sale', 'inventory_adjustment', 'inventory_count')
  );

create sequence if not exists public.inventory_count_number_seq;

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  status text not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint inventory_counts_number_present check (btrim(number) <> ''),
  constraint inventory_counts_status_check check (
    status in ('draft', 'in_progress', 'completed', 'cancelled')
  ),
  constraint inventory_counts_completed_at_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create unique index if not exists inventory_counts_number_unique
  on public.inventory_counts (number);

create index if not exists inventory_counts_created_at_idx
  on public.inventory_counts (created_at desc);

create index if not exists inventory_counts_status_idx
  on public.inventory_counts (status, created_at desc);

create table if not exists public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  expected_quantity numeric(14, 3) not null check (expected_quantity >= 0),
  actual_quantity numeric(14, 3) check (actual_quantity is null or actual_quantity >= 0),
  difference numeric(14, 3) generated always as (actual_quantity - expected_quantity) stored,
  created_at timestamptz not null default now(),
  constraint inventory_count_lines_item_unique unique (count_id, item_id)
);

create index if not exists inventory_count_lines_count_idx
  on public.inventory_count_lines (count_id, created_at);

create index if not exists inventory_count_lines_item_idx
  on public.inventory_count_lines (item_id);

create or replace function public.inventory_item_stock_qty(target_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(quantity), 0)
  from public.inventory_movements
  where item_id = target_item_id;
$$;

create or replace function public.assert_inventory_count_permission()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('inventory:inventory_count') then
    raise exception 'Недостаточно прав для инвентаризации.';
  end if;
end;
$$;

create or replace function public.lock_inventory_count(target_count_id uuid)
returns public.inventory_counts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
begin
  perform public.assert_inventory_count_permission();
  perform pg_advisory_xact_lock(871002, hashtext(target_count_id::text));

  select * into current_row
  from public.inventory_counts
  where id = target_count_id
  for update;

  if current_row.id is null then
    raise exception 'Документ инвентаризации не найден.';
  end if;

  return current_row;
end;
$$;

create or replace function public.assert_inventory_count_editable(current_row public.inventory_counts)
returns void
language plpgsql
stable
as $$
begin
  if current_row.status in ('completed', 'cancelled') then
    raise exception 'Документ закрыт для изменений.';
  end if;
end;
$$;

create or replace function public.mark_inventory_count_in_progress(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory_counts
  set status = 'in_progress'
  where id = target_count_id
    and status = 'draft';
end;
$$;

create or replace function public.apply_inventory_quantity_delta(
  target_item_id uuid,
  quantity_delta numeric,
  target_movement_type text,
  target_reference_type text,
  target_reference_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_id uuid;
  item_price numeric;
begin
  if quantity_delta is null or quantity_delta = 0 then
    return;
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if quantity_delta < 0 then
    perform public.consume_inventory_fifo(
      target_item_id,
      abs(quantity_delta),
      target_movement_type,
      target_reference_type,
      target_reference_id
    );
    return;
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  select purchase_price into item_price
  from public.inventory_items
  where id = target_item_id;

  insert into public.inventory_batches (
    item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
  )
  values (
    target_item_id,
    null,
    'Инвентаризация',
    current_date,
    coalesce(item_price, 0),
    quantity_delta,
    0
  )
  returning id into batch_id;

  insert into public.inventory_movements (
    item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
  )
  values (
    target_item_id,
    batch_id,
    quantity_delta,
    coalesce(item_price, 0),
    target_movement_type,
    target_reference_type,
    target_reference_id,
    auth.uid()
  );
end;
$$;

create or replace function public.adjust_inventory(
  target_item_id uuid,
  quantity_delta numeric,
  reason_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  adjustment_id uuid;
begin
  perform public.assert_inventory_count_permission();

  if btrim(coalesce(reason_text, '')) = '' then
    raise exception 'Укажите причину корректировки.';
  end if;

  if quantity_delta is null or quantity_delta = 0 then
    raise exception 'Количество корректировки не может быть нулевым.';
  end if;

  insert into public.inventory_adjustments (reason, created_by)
  values (btrim(reason_text), auth.uid())
  returning id into adjustment_id;

  perform public.apply_inventory_quantity_delta(
    target_item_id,
    quantity_delta,
    'inventory_adjustment',
    'inventory_adjustment',
    adjustment_id
  );

  perform public.record_audit(
    'inventory.adjusted',
    'inventory_adjustment',
    adjustment_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity_delta', quantity_delta)
  );

  return adjustment_id;
end;
$$;

create or replace function public.create_inventory_count(
  seed_mode text default 'empty',
  seed_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_number text;
  mode text;
begin
  perform public.assert_inventory_count_permission();

  mode := coalesce(nullif(btrim(seed_mode), ''), 'empty');
  if mode not in ('empty', 'in_stock') then
    raise exception 'Неизвестный способ заполнения документа.';
  end if;

  next_number := 'ИНВ-' || lpad(nextval('public.inventory_count_number_seq')::text, 6, '0');

  insert into public.inventory_counts (number, status, created_by)
  values (next_number, 'draft', auth.uid())
  returning id into result_id;

  if seed_item_id is not null then
    if not exists (select 1 from public.inventory_items where id = seed_item_id) then
      raise exception 'Позиция не найдена.';
    end if;

    insert into public.inventory_count_lines (count_id, item_id, expected_quantity)
    values (result_id, seed_item_id, public.inventory_item_stock_qty(seed_item_id));
  elsif mode = 'in_stock' then
    insert into public.inventory_count_lines (count_id, item_id, expected_quantity)
    select result_id, i.id, stock.qty
    from public.inventory_items i
    join (
      select item_id, coalesce(sum(quantity), 0) as qty
      from public.inventory_movements
      group by item_id
    ) stock on stock.item_id = i.id
    where stock.qty <> 0;
  end if;

  perform public.record_audit(
    'inventory.count_created',
    'inventory_count',
    result_id::text,
    jsonb_build_object('number', next_number, 'seed_mode', mode, 'seed_item_id', seed_item_id)
  );

  return result_id;
end;
$$;

create or replace function public.start_inventory_count(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
begin
  current_row := public.lock_inventory_count(target_count_id);
  perform public.assert_inventory_count_editable(current_row);

  if current_row.status = 'in_progress' then
    return;
  end if;

  update public.inventory_counts
  set status = 'in_progress'
  where id = target_count_id;

  perform public.record_audit('inventory.count_started', 'inventory_count', target_count_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.cancel_inventory_count(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
begin
  current_row := public.lock_inventory_count(target_count_id);
  perform public.assert_inventory_count_editable(current_row);

  update public.inventory_counts
  set status = 'cancelled'
  where id = target_count_id
    and status in ('draft', 'in_progress');

  if not found then
    raise exception 'Документ нельзя отменить.';
  end if;

  perform public.record_audit('inventory.count_cancelled', 'inventory_count', target_count_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.add_inventory_count_item(target_count_id uuid, target_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  line_id uuid;
begin
  current_row := public.lock_inventory_count(target_count_id);
  perform public.assert_inventory_count_editable(current_row);

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  insert into public.inventory_count_lines (count_id, item_id, expected_quantity)
  values (target_count_id, target_item_id, public.inventory_item_stock_qty(target_item_id))
  on conflict (count_id, item_id) do update
    set expected_quantity = public.inventory_count_lines.expected_quantity
  returning id into line_id;

  perform public.mark_inventory_count_in_progress(target_count_id);

  return line_id;
end;
$$;

create or replace function public.remove_inventory_count_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  line_count_id uuid;
begin
  select count_id into line_count_id
  from public.inventory_count_lines
  where id = target_line_id;

  if line_count_id is null then
    raise exception 'Строка не найдена.';
  end if;

  current_row := public.lock_inventory_count(line_count_id);
  perform public.assert_inventory_count_editable(current_row);

  delete from public.inventory_count_lines where id = target_line_id;
end;
$$;

create or replace function public.set_inventory_count_line_actual(
  target_line_id uuid,
  next_actual numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  line_count_id uuid;
begin
  if next_actual is null or next_actual < 0 then
    raise exception 'Фактическое количество не может быть отрицательным.';
  end if;

  select count_id into line_count_id
  from public.inventory_count_lines
  where id = target_line_id;

  if line_count_id is null then
    raise exception 'Строка не найдена.';
  end if;

  current_row := public.lock_inventory_count(line_count_id);
  perform public.assert_inventory_count_editable(current_row);

  update public.inventory_count_lines
  set actual_quantity = next_actual
  where id = target_line_id;

  perform public.mark_inventory_count_in_progress(line_count_id);
end;
$$;

create or replace function public.increment_inventory_count_item(
  target_count_id uuid,
  target_item_id uuid,
  increment_by numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  line_id uuid;
begin
  if increment_by is null or increment_by <= 0 then
    raise exception 'Приращение должно быть больше нуля.';
  end if;

  current_row := public.lock_inventory_count(target_count_id);
  perform public.assert_inventory_count_editable(current_row);

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  insert into public.inventory_count_lines (count_id, item_id, expected_quantity, actual_quantity)
  values (
    target_count_id,
    target_item_id,
    public.inventory_item_stock_qty(target_item_id),
    increment_by
  )
  on conflict (count_id, item_id) do update
    set actual_quantity = coalesce(public.inventory_count_lines.actual_quantity, 0) + increment_by
  returning id into line_id;

  perform public.mark_inventory_count_in_progress(target_count_id);
  return line_id;
end;
$$;

create or replace function public.complete_inventory_count(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  uncounted integer;
  line_row public.inventory_count_lines%rowtype;
  updated_id uuid;
begin
  current_row := public.lock_inventory_count(target_count_id);

  if current_row.status = 'completed' then
    raise exception 'Инвентаризация уже проведена.';
  end if;

  if current_row.status = 'cancelled' then
    raise exception 'Отменённый документ нельзя провести.';
  end if;

  if not exists (select 1 from public.inventory_count_lines where count_id = target_count_id) then
    raise exception 'Добавьте хотя бы одну позицию.';
  end if;

  select count(*) into uncounted
  from public.inventory_count_lines
  where count_id = target_count_id
    and actual_quantity is null;

  if uncounted > 0 then
    raise exception 'Укажите факт по всем строкам. Не пересчитано: %.', uncounted;
  end if;

  for line_row in
    select *
    from public.inventory_count_lines
    where count_id = target_count_id
      and coalesce(difference, 0) <> 0
    order by created_at, id
  loop
    perform public.apply_inventory_quantity_delta(
      line_row.item_id,
      line_row.difference,
      'inventory_adjustment',
      'inventory_count',
      target_count_id
    );
  end loop;

  update public.inventory_counts
  set status = 'completed',
      completed_at = now()
  where id = target_count_id
    and status in ('draft', 'in_progress')
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Инвентаризация уже проведена.';
  end if;

  perform public.record_audit(
    'inventory.count_completed',
    'inventory_count',
    target_count_id::text,
    jsonb_build_object('number', current_row.number)
  );
end;
$$;

create or replace function public.list_inventory_counts(
  status_filter text default '',
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  number text,
  status text,
  created_by uuid,
  created_at timestamptz,
  completed_at timestamptz,
  actor_name text,
  line_count bigint,
  counted_count bigint,
  discrepancy_count bigint,
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
  status_value text;
begin
  perform public.assert_inventory_count_permission();

  status_value := btrim(coalesce(status_filter, ''));
  if status_value <> '' and status_value not in ('draft', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Неизвестный статус.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    c.id,
    c.number,
    c.status,
    c.created_by,
    c.created_at,
    c.completed_at,
    coalesce(p.full_name, '') as actor_name,
    count(l.id) as line_count,
    count(l.id) filter (where l.actual_quantity is not null) as counted_count,
    count(l.id) filter (where l.actual_quantity is not null and l.difference <> 0) as discrepancy_count,
    count(*) over() as total_count
  from public.inventory_counts c
  left join public.profiles p on p.id = c.created_by
  left join public.inventory_count_lines l on l.count_id = c.id
  where status_value = '' or c.status = status_value
  group by c.id, c.number, c.status, c.created_by, c.created_at, c.completed_at, p.full_name
  order by c.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_inventory_count(target_count_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  perform public.assert_inventory_count_permission();

  select jsonb_build_object(
    'id', c.id,
    'number', c.number,
    'status', c.status,
    'created_by', c.created_by,
    'created_at', c.created_at,
    'completed_at', c.completed_at,
    'actor_name', coalesce(p.full_name, ''),
    'line_count', coalesce((select count(*) from public.inventory_count_lines l where l.count_id = c.id), 0),
    'counted_count', coalesce((
      select count(*) from public.inventory_count_lines l
      where l.count_id = c.id and l.actual_quantity is not null
    ), 0),
    'uncounted_count', coalesce((
      select count(*) from public.inventory_count_lines l
      where l.count_id = c.id and l.actual_quantity is null
    ), 0),
    'discrepancy_count', coalesce((
      select count(*) from public.inventory_count_lines l
      where l.count_id = c.id and l.actual_quantity is not null and l.difference <> 0
    ), 0)
  )
  into payload
  from public.inventory_counts c
  left join public.profiles p on p.id = c.created_by
  where c.id = target_count_id;

  if payload is null then
    raise exception 'Документ инвентаризации не найден.';
  end if;

  return payload;
end;
$$;

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

create or replace function public.get_inventory_count_statement(target_count_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  header jsonb;
begin
  perform public.assert_inventory_count_permission();

  select jsonb_build_object(
    'id', c.id,
    'number', c.number,
    'status', c.status,
    'created_at', c.created_at,
    'completed_at', c.completed_at,
    'actor_name', coalesce(p.full_name, '')
  )
  into header
  from public.inventory_counts c
  left join public.profiles p on p.id = c.created_by
  where c.id = target_count_id;

  if header is null then
    raise exception 'Документ инвентаризации не найден.';
  end if;

  return header || jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.item_name)
      from (
        select
          l.id,
          l.item_id,
          i.name as item_name,
          i.code as item_code,
          i.article as item_article,
          coalesce(u.name, '') as unit_name,
          l.expected_quantity,
          l.actual_quantity,
          l.difference
        from public.inventory_count_lines l
        join public.inventory_items i on i.id = l.item_id
        left join public.reference_items u on u.id = i.unit_id
        where l.count_id = target_count_id
          and l.actual_quantity is not null
          and l.difference <> 0
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
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
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
            when 'inventory_count' then 'Инвентаризация ' || coalesce(c.number, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        left join public.inventory_counts c on m.reference_type = 'inventory_count' and c.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;

drop policy if exists inventory_counts_select on public.inventory_counts;
create policy inventory_counts_select
  on public.inventory_counts
  for select
  to authenticated
  using (public.has_permission('inventory:inventory_count') or public.has_permission('inventory:read'));

drop policy if exists inventory_count_lines_select on public.inventory_count_lines;
create policy inventory_count_lines_select
  on public.inventory_count_lines
  for select
  to authenticated
  using (public.has_permission('inventory:inventory_count') or public.has_permission('inventory:read'));

revoke all on function public.inventory_item_stock_qty(uuid) from public;
revoke all on function public.assert_inventory_count_permission() from public;
revoke all on function public.lock_inventory_count(uuid) from public;
revoke all on function public.assert_inventory_count_editable(public.inventory_counts) from public;
revoke all on function public.mark_inventory_count_in_progress(uuid) from public;
revoke all on function public.apply_inventory_quantity_delta(uuid, numeric, text, text, uuid) from public;
revoke all on function public.create_inventory_count(text, uuid) from public;
revoke all on function public.start_inventory_count(uuid) from public;
revoke all on function public.cancel_inventory_count(uuid) from public;
revoke all on function public.add_inventory_count_item(uuid, uuid) from public;
revoke all on function public.remove_inventory_count_line(uuid) from public;
revoke all on function public.set_inventory_count_line_actual(uuid, numeric) from public;
revoke all on function public.increment_inventory_count_item(uuid, uuid, numeric) from public;
revoke all on function public.complete_inventory_count(uuid) from public;
revoke all on function public.list_inventory_counts(text, integer, integer) from public;
revoke all on function public.get_inventory_count(uuid) from public;
revoke all on function public.list_inventory_count_lines(uuid, text, text, integer, integer) from public;
revoke all on function public.get_inventory_count_statement(uuid) from public;

grant execute on function public.create_inventory_count(text, uuid) to authenticated;
grant execute on function public.start_inventory_count(uuid) to authenticated;
grant execute on function public.cancel_inventory_count(uuid) to authenticated;
grant execute on function public.add_inventory_count_item(uuid, uuid) to authenticated;
grant execute on function public.remove_inventory_count_line(uuid) to authenticated;
grant execute on function public.set_inventory_count_line_actual(uuid, numeric) to authenticated;
grant execute on function public.increment_inventory_count_item(uuid, uuid, numeric) to authenticated;
grant execute on function public.complete_inventory_count(uuid) to authenticated;
grant execute on function public.list_inventory_counts(text, integer, integer) to authenticated;
grant execute on function public.get_inventory_count(uuid) to authenticated;
grant execute on function public.list_inventory_count_lines(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.get_inventory_count_statement(uuid) to authenticated;
