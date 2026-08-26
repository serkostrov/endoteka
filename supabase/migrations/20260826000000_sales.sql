-- Эндотека: продажи внешним клиентам. Списание FIFO только при подтверждении счёта.

create sequence if not exists public.sale_invoice_number_seq;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  customer_id uuid references public.customers (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  sale_date date not null default current_date,
  status text not null default 'draft',
  total numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint sales_invoice_present check (btrim(invoice_number) <> ''),
  constraint sales_status_check check (status in ('draft', 'confirmed', 'cancelled')),
  constraint sales_total_check check (total >= 0),
  constraint sales_confirmed_at_check check (
    (status = 'confirmed' and confirmed_at is not null)
    or (status <> 'confirmed' and confirmed_at is null)
  )
);

create unique index if not exists sales_invoice_number_unique
  on public.sales (invoice_number);

create index if not exists sales_created_at_idx
  on public.sales (created_at desc);

create index if not exists sales_status_idx
  on public.sales (status, created_at desc);

create index if not exists sales_customer_idx
  on public.sales (customer_id);

create table if not exists public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  amount numeric(14, 2) generated always as (round((quantity * unit_price)::numeric, 2)) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint sale_lines_item_unique unique (sale_id, item_id)
);

create index if not exists sale_lines_sale_idx
  on public.sale_lines (sale_id, sort_order, created_at);

create table if not exists public.sale_allocations (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  line_id uuid not null references public.sale_lines (id) on delete restrict,
  batch_id uuid not null references public.inventory_batches (id) on delete restrict,
  movement_id uuid not null references public.inventory_movements (id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 2) not null,
  created_at timestamptz not null default now()
);

create index if not exists sale_allocations_sale_idx
  on public.sale_allocations (sale_id);

create index if not exists sale_allocations_line_idx
  on public.sale_allocations (line_id);

create or replace function public.assert_sales_read()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('sales:read') then
    raise exception 'Недостаточно прав для просмотра продаж.';
  end if;
end;
$$;

create or replace function public.assert_sales_write()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('sales:create')
    or public.has_permission('sales:update')
  ) then
    raise exception 'Недостаточно прав для изменения продажи.';
  end if;
end;
$$;

create or replace function public.assert_sales_create()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('sales:create') then
    raise exception 'Недостаточно прав для оформления продажи.';
  end if;
end;
$$;

create or replace function public.lock_sale(target_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
begin
  perform pg_advisory_xact_lock(871003, hashtext(target_sale_id::text));

  select * into current_row
  from public.sales
  where id = target_sale_id
  for update;

  if current_row.id is null then
    raise exception 'Продажа не найдена.';
  end if;

  return current_row;
end;
$$;

create or replace function public.assert_sale_draft(current_row public.sales)
returns void
language plpgsql
stable
as $$
begin
  if current_row.status = 'confirmed' then
    raise exception 'Продажа уже подтверждена.';
  end if;

  if current_row.status = 'cancelled' then
    raise exception 'Отменённую продажу нельзя изменить.';
  end if;
end;
$$;

create or replace function public.refresh_sale_total(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sales
  set total = coalesce((
    select round(sum(amount), 2)
    from public.sale_lines
    where sale_id = target_sale_id
  ), 0)
  where id = target_sale_id;
end;
$$;

create or replace function public.next_sale_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return 'СЧ-' || lpad(nextval('public.sale_invoice_number_seq')::text, 6, '0');
end;
$$;

create or replace function public.preview_inventory_fifo(
  target_item_id uuid,
  consume_quantity numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  remaining numeric;
  take numeric;
  lines jsonb := '[]'::jsonb;
  batch_row record;
begin
  if not (
    public.has_permission('sales:read')
    or public.has_permission('sales:create')
    or public.can_read_inventory()
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  if consume_quantity is null or consume_quantity <= 0 then
    return jsonb_build_object('lines', '[]'::jsonb, 'enough', true, 'shortfall', 0);
  end if;

  remaining := consume_quantity;

  for batch_row in
    select
      b.id,
      b.receipt_date,
      b.supplier,
      b.remaining_quantity,
      b.purchase_price
    from public.inventory_batches b
    where b.item_id = target_item_id
      and b.remaining_quantity > 0
    order by b.receipt_date asc, b.created_at asc, b.id asc
  loop
    exit when remaining <= 0;
    take := least(batch_row.remaining_quantity, remaining);
    lines := lines || jsonb_build_array(jsonb_build_object(
      'batch_id', batch_row.id,
      'receipt_date', batch_row.receipt_date,
      'supplier', coalesce(batch_row.supplier, ''),
      'quantity', take,
      'unit_cost', batch_row.purchase_price
    ));
    remaining := remaining - take;
  end loop;

  return jsonb_build_object(
    'lines', lines,
    'enough', remaining <= 0,
    'shortfall', greatest(remaining, 0)
  );
end;
$$;

create or replace function public.create_sale(
  p_customer_id uuid default null,
  p_sale_date date default null,
  p_invoice_number text default null,
  p_seed_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_number text;
  seed_price numeric;
begin
  perform public.assert_sales_create();

  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Клиент не найден.';
  end if;

  next_number := nullif(btrim(coalesce(p_invoice_number, '')), '');
  if next_number is null then
    next_number := public.next_sale_invoice_number();
  end if;

  insert into public.sales (invoice_number, customer_id, created_by, sale_date, status, total)
  values (next_number, p_customer_id, auth.uid(), coalesce(p_sale_date, current_date), 'draft', 0)
  returning id into result_id;

  if p_seed_item_id is not null then
    if not exists (select 1 from public.inventory_items where id = p_seed_item_id) then
      raise exception 'Позиция не найдена.';
    end if;

    select retail_price into seed_price
    from public.inventory_items
    where id = p_seed_item_id;

    insert into public.sale_lines (sale_id, item_id, quantity, unit_price, sort_order)
    values (result_id, p_seed_item_id, 1, coalesce(seed_price, 0), 0);

    perform public.refresh_sale_total(result_id);
  end if;

  perform public.record_audit(
    'sale.created',
    'sale',
    result_id::text,
    jsonb_build_object('invoice_number', next_number, 'customer_id', p_customer_id)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Номер счёта уже используется.';
end;
$$;

create or replace function public.update_sale(
  target_sale_id uuid,
  p_customer_id uuid default null,
  p_sale_date date default null,
  p_invoice_number text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  next_number text;
begin
  perform public.assert_sales_write();
  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Клиент не найден.';
  end if;

  next_number := nullif(btrim(coalesce(p_invoice_number, '')), '');

  update public.sales
  set
    customer_id = p_customer_id,
    sale_date = coalesce(p_sale_date, sale_date),
    invoice_number = coalesce(next_number, invoice_number)
  where id = target_sale_id;
exception
  when unique_violation then
    raise exception 'Номер счёта уже используется.';
end;
$$;

create or replace function public.add_sale_line(
  target_sale_id uuid,
  target_item_id uuid,
  line_quantity numeric,
  line_unit_price numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  next_price numeric;
  next_order integer;
  result_id uuid;
begin
  perform public.assert_sales_write();
  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  next_price := line_unit_price;
  if next_price is null then
    select retail_price into next_price
    from public.inventory_items
    where id = target_item_id;
  end if;

  if next_price is null or next_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  select coalesce(max(sort_order), -1) + 1 into next_order
  from public.sale_lines
  where sale_id = target_sale_id;

  insert into public.sale_lines (sale_id, item_id, quantity, unit_price, sort_order)
  values (target_sale_id, target_item_id, line_quantity, next_price, next_order)
  on conflict (sale_id, item_id) do update
    set quantity = public.sale_lines.quantity + excluded.quantity,
        unit_price = excluded.unit_price
  returning id into result_id;

  perform public.refresh_sale_total(target_sale_id);
  return result_id;
end;
$$;

create or replace function public.set_sale_line(
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
  current_row public.sales%rowtype;
  target_sale_id uuid;
begin
  perform public.assert_sales_write();

  select sale_id into target_sale_id
  from public.sale_lines
  where id = target_line_id;

  if target_sale_id is null then
    raise exception 'Строка продажи не найдена.';
  end if;

  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.sale_lines
  set quantity = line_quantity,
      unit_price = line_unit_price
  where id = target_line_id;

  perform public.refresh_sale_total(target_sale_id);
end;
$$;

create or replace function public.remove_sale_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  target_sale_id uuid;
begin
  perform public.assert_sales_write();

  select sale_id into target_sale_id
  from public.sale_lines
  where id = target_line_id;

  if target_sale_id is null then
    raise exception 'Строка продажи не найдена.';
  end if;

  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  delete from public.sale_lines
  where id = target_line_id;

  perform public.refresh_sale_total(target_sale_id);
end;
$$;

create or replace function public.confirm_sale(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  line_row public.sale_lines%rowtype;
  fifo jsonb;
  alloc jsonb;
  updated_id uuid;
begin
  perform public.assert_sales_create();
  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  if current_row.customer_id is null then
    raise exception 'Укажите покупателя.';
  end if;

  if not exists (select 1 from public.sale_lines where sale_id = target_sale_id) then
    raise exception 'Добавьте хотя бы одну позицию.';
  end if;

  for line_row in
    select *
    from public.sale_lines
    where sale_id = target_sale_id
    order by sort_order, created_at, id
  loop
    fifo := public.consume_inventory_fifo(
      line_row.item_id,
      line_row.quantity,
      'sale',
      'sale',
      target_sale_id
    );

    for alloc in
      select value
      from jsonb_array_elements(coalesce(fifo->'lines', '[]'::jsonb))
    loop
      insert into public.sale_allocations (
        sale_id, line_id, batch_id, movement_id, quantity, unit_cost
      )
      values (
        target_sale_id,
        line_row.id,
        (alloc->>'batch_id')::uuid,
        (alloc->>'movement_id')::uuid,
        (alloc->>'quantity')::numeric,
        (alloc->>'unit_price')::numeric
      );
    end loop;
  end loop;

  update public.sales
  set status = 'confirmed',
      confirmed_at = now()
  where id = target_sale_id
    and status = 'draft'
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Продажа уже подтверждена.';
  end if;

  perform public.record_audit(
    'sale.confirmed',
    'sale',
    target_sale_id::text,
    jsonb_build_object('invoice_number', current_row.invoice_number, 'total', current_row.total)
  );
end;
$$;

create or replace function public.cancel_sale(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  updated_id uuid;
begin
  perform public.assert_sales_write();
  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  update public.sales
  set status = 'cancelled'
  where id = target_sale_id
    and status = 'draft'
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Продажу нельзя отменить.';
  end if;

  perform public.record_audit(
    'sale.cancelled',
    'sale',
    target_sale_id::text,
    jsonb_build_object('invoice_number', current_row.invoice_number)
  );
end;
$$;

create or replace function public.list_sales(
  search_query text default '',
  status_filter text default '',
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  invoice_number text,
  customer_id uuid,
  customer_name text,
  created_by uuid,
  created_by_name text,
  sale_date date,
  status text,
  total numeric,
  created_at timestamptz,
  confirmed_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  status_value text;
  safe_page integer;
  safe_size integer;
begin
  perform public.assert_sales_read();

  status_value := coalesce(nullif(btrim(status_filter), ''), '');
  if status_value <> '' and status_value not in ('draft', 'confirmed', 'cancelled') then
    raise exception 'Неизвестный статус продажи.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    s.id,
    s.invoice_number,
    s.customer_id,
    coalesce(c.name, '') as customer_name,
    s.created_by,
    coalesce(p.full_name, '') as created_by_name,
    s.sale_date,
    s.status,
    s.total,
    s.created_at,
    s.confirmed_at,
    count(*) over() as total_count
  from public.sales s
  left join public.customers c on c.id = s.customer_id
  left join public.profiles p on p.id = s.created_by
  where (status_value = '' or s.status = status_value)
    and (
      btrim(coalesce(search_query, '')) = ''
      or s.invoice_number ilike term escape '\'
      or c.name ilike term escape '\'
    )
  order by s.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_sale(target_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
  lines_json jsonb := '[]'::jsonb;
  rec record;
  preview jsonb;
  stock_qty numeric;
begin
  perform public.assert_sales_read();

  select jsonb_build_object(
    'id', s.id,
    'invoice_number', s.invoice_number,
    'customer_id', s.customer_id,
    'customer_name', coalesce(c.name, ''),
    'customer_inn', coalesce(c.inn, ''),
    'customer_phone', coalesce(c.phone, ''),
    'created_by', s.created_by,
    'created_by_name', coalesce(p.full_name, ''),
    'sale_date', s.sale_date,
    'status', s.status,
    'total', s.total,
    'created_at', s.created_at,
    'confirmed_at', s.confirmed_at
  )
  into payload
  from public.sales s
  left join public.customers c on c.id = s.customer_id
  left join public.profiles p on p.id = s.created_by
  where s.id = target_sale_id;

  if payload is null then
    raise exception 'Продажа не найдена.';
  end if;

  for rec in
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
      l.amount,
      l.sort_order
    from public.sale_lines l
    join public.inventory_items i on i.id = l.item_id
    left join public.reference_items u on u.id = i.unit_id
    where l.sale_id = target_sale_id
    order by l.sort_order, l.created_at, l.id
  loop
    stock_qty := public.inventory_item_stock_qty(rec.item_id);

    if payload->>'status' = 'draft' then
      preview := public.preview_inventory_fifo(rec.item_id, rec.quantity);
    else
      preview := jsonb_build_object('lines', '[]'::jsonb, 'enough', true, 'shortfall', 0);
    end if;

    lines_json := lines_json || jsonb_build_array(jsonb_build_object(
      'id', rec.id,
      'item_id', rec.item_id,
      'item_name', rec.item_name,
      'item_code', rec.item_code,
      'item_article', rec.item_article,
      'item_barcode', rec.item_barcode,
      'unit_name', rec.unit_name,
      'quantity', rec.quantity,
      'unit_price', rec.unit_price,
      'amount', rec.amount,
      'stock_quantity', stock_qty,
      'fifo_preview', preview,
      'allocations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'batch_id', a.batch_id,
          'movement_id', a.movement_id,
          'quantity', a.quantity,
          'unit_cost', a.unit_cost,
          'receipt_date', b.receipt_date,
          'supplier', coalesce(b.supplier, '')
        ) order by b.receipt_date, a.created_at)
        from public.sale_allocations a
        join public.inventory_batches b on b.id = a.batch_id
        where a.line_id = rec.id
      ), '[]'::jsonb)
    ));
  end loop;

  return payload || jsonb_build_object('lines', lines_json);
end;
$$;

create or replace function public.search_inventory_items(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20
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
  where btrim(coalesce(search_query, '')) = ''
     or i.name ilike term escape '\'
     or i.code ilike term escape '\'
     or i.article ilike term escape '\'
     or i.barcode ilike term escape '\'
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
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
  where i.barcode = code_value
     or i.code = code_value
  order by i.name
  limit 20;
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
            when 'order' then coalesce(o.number, '—')
            when 'receipt' then 'Приход · ' || coalesce(r.supplier, '')
            when 'sale' then coalesce(nullif(sa.invoice_number, ''), nullif(legacy.invoice_number, ''), '—')
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            when 'inventory_count' then 'Инвентаризация ' || coalesce(c.number, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.sales sa on m.reference_type = 'sale' and sa.id = m.reference_id
        left join public.inventory_sales legacy on m.reference_type = 'sale' and legacy.id = m.reference_id
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

alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_allocations enable row level security;

drop policy if exists sales_select on public.sales;
create policy sales_select
  on public.sales
  for select
  to authenticated
  using (public.has_permission('sales:read'));

drop policy if exists sale_lines_select on public.sale_lines;
create policy sale_lines_select
  on public.sale_lines
  for select
  to authenticated
  using (public.has_permission('sales:read'));

drop policy if exists sale_allocations_select on public.sale_allocations;
create policy sale_allocations_select
  on public.sale_allocations
  for select
  to authenticated
  using (public.has_permission('sales:read'));

revoke all on function public.assert_sales_read() from public;
revoke all on function public.assert_sales_write() from public;
revoke all on function public.assert_sales_create() from public;
revoke all on function public.lock_sale(uuid) from public;
revoke all on function public.assert_sale_draft(public.sales) from public;
revoke all on function public.refresh_sale_total(uuid) from public;
revoke all on function public.next_sale_invoice_number() from public;
revoke all on function public.preview_inventory_fifo(uuid, numeric) from public;
revoke all on function public.create_sale(uuid, date, text, uuid) from public;
revoke all on function public.update_sale(uuid, uuid, date, text) from public;
revoke all on function public.add_sale_line(uuid, uuid, numeric, numeric) from public;
revoke all on function public.set_sale_line(uuid, numeric, numeric) from public;
revoke all on function public.remove_sale_line(uuid) from public;
revoke all on function public.confirm_sale(uuid) from public;
revoke all on function public.cancel_sale(uuid) from public;
revoke all on function public.list_sales(text, text, integer, integer) from public;
revoke all on function public.get_sale(uuid) from public;

grant execute on function public.preview_inventory_fifo(uuid, numeric) to authenticated;
grant execute on function public.create_sale(uuid, date, text, uuid) to authenticated;
grant execute on function public.update_sale(uuid, uuid, date, text) to authenticated;
grant execute on function public.add_sale_line(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.set_sale_line(uuid, numeric, numeric) to authenticated;
grant execute on function public.remove_sale_line(uuid) to authenticated;
grant execute on function public.confirm_sale(uuid) to authenticated;
grant execute on function public.cancel_sale(uuid) to authenticated;
grant execute on function public.list_sales(text, text, integer, integer) to authenticated;
grant execute on function public.get_sale(uuid) to authenticated;
