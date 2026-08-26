-- Эндотека: склад. Остаток считается по журналу движений.
-- remaining_quantity на партии — кэш, который обновляет только триггер журнала.
-- Списание FIFO выполняется одной SECURITY DEFINER-транзакцией, не серией запросов с клиента.

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('inventory:read', 'inventory:write_off')
where r.code = 'diagnostic_engineer'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.permission_id = p.id
  );

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'inventory:write_off'
where r.code = 'chief_engineer'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.permission_id = p.id
  );

create sequence if not exists public.inventory_item_code_seq;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  article text not null default '',
  barcode text not null default '',
  name text not null,
  category_id uuid not null references public.reference_items (id) on delete restrict,
  unit_id uuid not null references public.reference_items (id) on delete restrict,
  purchase_price numeric(14, 2) not null default 0 check (purchase_price >= 0),
  repair_price numeric(14, 2) not null default 0 check (repair_price >= 0),
  retail_price numeric(14, 2) not null default 0 check (retail_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items_name_present check (btrim(name) <> ''),
  constraint inventory_items_code_present check (btrim(code) <> '')
);

create unique index if not exists inventory_items_name_unique
  on public.inventory_items (lower(btrim(name)));

create index if not exists inventory_items_barcode_idx
  on public.inventory_items (barcode)
  where barcode <> '';

create index if not exists inventory_items_article_idx
  on public.inventory_items (lower(article));

create index if not exists inventory_items_code_idx
  on public.inventory_items (lower(code));

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute procedure public.set_updated_at();

create table if not exists public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  receipt_date date not null,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_receipts_supplier_present check (btrim(supplier) <> '')
);

create index if not exists inventory_receipts_created_at_idx
  on public.inventory_receipts (created_at desc);

create table if not exists public.inventory_sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null default '',
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  reason text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_adjustments_reason_present check (btrim(reason) <> '')
);

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  receipt_id uuid references public.inventory_receipts (id) on delete restrict,
  supplier text not null default '',
  receipt_date date not null,
  purchase_price numeric(14, 2) not null check (purchase_price >= 0),
  quantity numeric(14, 3) not null check (quantity > 0),
  remaining_quantity numeric(14, 3) not null default 0,
  created_at timestamptz not null default now(),
  constraint inventory_batches_remaining_check check (
    remaining_quantity >= 0 and remaining_quantity <= quantity
  )
);

create index if not exists inventory_batches_fifo_idx
  on public.inventory_batches (item_id, receipt_date, created_at, id)
  where remaining_quantity > 0;

create index if not exists inventory_batches_item_idx
  on public.inventory_batches (item_id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  batch_id uuid not null references public.inventory_batches (id) on delete restrict,
  quantity numeric(14, 3) not null,
  unit_price numeric(14, 2) not null default 0 check (unit_price >= 0),
  movement_type text not null,
  reference_type text not null,
  reference_id uuid not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_movements_quantity_nonzero check (quantity <> 0),
  constraint inventory_movements_type_check check (
    movement_type in ('receipt', 'repair_consumption', 'sale', 'inventory_adjustment')
  ),
  constraint inventory_movements_reference_check check (
    reference_type in ('receipt', 'order', 'sale', 'inventory_adjustment')
  )
);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (item_id, created_at desc);

create index if not exists inventory_movements_batch_idx
  on public.inventory_movements (batch_id, created_at);

create index if not exists inventory_movements_reference_idx
  on public.inventory_movements (reference_type, reference_id);

create or replace function public.prevent_inventory_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Движения склада нельзя изменять или удалять.';
end;
$$;

drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable
  before update or delete on public.inventory_movements
  for each row execute procedure public.prevent_inventory_movement_mutation();

create or replace function public.protect_inventory_batch()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Партию нельзя удалить.';
  end if;

  if new.item_id is distinct from old.item_id
     or new.receipt_id is distinct from old.receipt_id
     or new.supplier is distinct from old.supplier
     or new.receipt_date is distinct from old.receipt_date
     or new.purchase_price is distinct from old.purchase_price
     or new.quantity is distinct from old.quantity then
    raise exception 'Партию нельзя изменять.';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_batches_protect on public.inventory_batches;
create trigger inventory_batches_protect
  before update or delete on public.inventory_batches
  for each row execute procedure public.protect_inventory_batch();

create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory_batches
  set remaining_quantity = remaining_quantity + new.quantity
  where id = new.batch_id;

  if not found then
    raise exception 'Партия не найдена.';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_movements_apply on public.inventory_movements;
create trigger inventory_movements_apply
  after insert on public.inventory_movements
  for each row execute procedure public.apply_inventory_movement();

create or replace function public.assert_inventory_category(target_category_id uuid)
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
    where i.id = target_category_id
      and s.code = 'inventory_categories'
      and i.is_active = true
  ) then
    raise exception 'Выберите категорию из справочника склада.';
  end if;
end;
$$;

create or replace function public.assert_inventory_unit(target_unit_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  unit_code text;
begin
  select i.code
    into unit_code
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id
  where i.id = target_unit_id
    and s.code = 'units_of_measure'
    and i.is_active = true;

  if unit_code is null then
    raise exception 'Выберите единицу измерения.';
  end if;

  if unit_code not in ('pcs', 'pack') then
    raise exception 'Допустимые единицы: шт и упак.';
  end if;
end;
$$;

create or replace function public.can_read_inventory()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('inventory:read')
      or public.has_permission('inventory:receive')
      or public.has_permission('inventory:write_off')
      or public.has_permission('inventory:inventory_count');
$$;

create or replace function public.raise_inventory_name_duplicate(item_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
begin
  select id into existing_id
  from public.inventory_items
  where lower(btrim(name)) = lower(btrim(item_name))
  limit 1;

  raise exception 'Такое наименование уже в справочнике'
    using hint = coalesce(existing_id::text, '');
end;
$$;

create or replace function public.create_inventory_item(
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
    code, article, barcode, name, category_id, unit_id, purchase_price, repair_price, retail_price
  )
  values (
    next_code,
    btrim(coalesce(item_article, '')),
    btrim(coalesce(item_barcode, '')),
    btrim(item_name),
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
  item_retail_price numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_code text;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для изменения номенклатуры.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if btrim(coalesce(item_name, '')) = '' then
    raise exception 'Укажите наименование.';
  end if;

  if item_category_id is null or item_unit_id is null then
    raise exception 'Категория и единица измерения обязательны.';
  end if;

  perform public.assert_inventory_category(item_category_id);
  perform public.assert_inventory_unit(item_unit_id);

  if coalesce(item_purchase_price, 0) < 0 or coalesce(item_repair_price, 0) < 0 or coalesce(item_retail_price, 0) < 0 then
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
    name = btrim(item_name),
    category_id = item_category_id,
    unit_id = item_unit_id,
    purchase_price = coalesce(item_purchase_price, 0),
    repair_price = coalesce(item_repair_price, 0),
    retail_price = coalesce(item_retail_price, 0)
  where id = target_item_id;

  perform public.record_audit(
    'inventory.item_updated',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', btrim(item_name), 'code', next_code)
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
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

create or replace function public.find_inventory_item_by_name(name_query text, exclude_id uuid default null)
returns table (id uuid, name text, code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('inventory:receive')
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  if btrim(coalesce(name_query, '')) = '' then
    return;
  end if;

  return query
  select i.id, i.name, i.code
  from public.inventory_items i
  where lower(btrim(i.name)) = lower(btrim(name_query))
    and (exclude_id is null or i.id <> exclude_id)
  limit 5;
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

create or replace function public.consume_inventory_fifo(
  target_item_id uuid,
  consume_quantity numeric,
  target_movement_type text,
  target_reference_type text,
  target_reference_id uuid
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

  if available < consume_quantity then
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
    raise exception 'Недостаточно остатка.';
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
  lines jsonb
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
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для прихода.';
  end if;

  if btrim(coalesce(supplier_name, '')) = '' then
    raise exception 'Укажите поставщика.';
  end if;

  if doc_receipt_date is null then
    raise exception 'Укажите дату прихода.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(lines, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  insert into public.inventory_receipts (supplier, receipt_date, notes, created_by)
  values (btrim(supplier_name), doc_receipt_date, btrim(coalesce(doc_notes, '')), auth.uid())
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
      btrim(supplier_name),
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
    jsonb_build_object('supplier', btrim(supplier_name), 'lines', line_count)
  );

  return receipt_id;
end;
$$;

create or replace function public.consume_inventory_for_order(
  target_order_id uuid,
  target_item_id uuid,
  consume_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания в ремонт.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  result := public.consume_inventory_fifo(
    target_item_id,
    consume_quantity,
    'repair_consumption',
    'order',
    target_order_id
  );

  perform public.record_audit(
    'inventory.consumed_repair',
    'order',
    target_order_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity', consume_quantity)
  );

  return result;
end;
$$;

create or replace function public.consume_inventory_for_sale(
  target_item_id uuid,
  consume_quantity numeric,
  invoice_number text default '',
  sale_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_id uuid;
begin
  if not (public.has_permission('inventory:write_off') or public.has_permission('sales:create')) then
    raise exception 'Недостаточно прав для продажи со склада.';
  end if;

  insert into public.inventory_sales (invoice_number, notes, created_by)
  values (btrim(coalesce(invoice_number, '')), btrim(coalesce(sale_notes, '')), auth.uid())
  returning id into sale_id;

  perform public.consume_inventory_fifo(
    target_item_id,
    consume_quantity,
    'sale',
    'sale',
    sale_id
  );

  perform public.record_audit(
    'inventory.sold',
    'inventory_sale',
    sale_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity', consume_quantity, 'invoice_number', btrim(coalesce(invoice_number, '')))
  );

  return sale_id;
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
  batch_id uuid;
  item_price numeric;
begin
  if not public.has_permission('inventory:inventory_count') then
    raise exception 'Недостаточно прав для инвентаризации.';
  end if;

  if btrim(coalesce(reason_text, '')) = '' then
    raise exception 'Укажите причину корректировки.';
  end if;

  if quantity_delta is null or quantity_delta = 0 then
    raise exception 'Количество корректировки не может быть нулевым.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  insert into public.inventory_adjustments (reason, created_by)
  values (btrim(reason_text), auth.uid())
  returning id into adjustment_id;

  if quantity_delta < 0 then
    perform public.consume_inventory_fifo(
      target_item_id,
      abs(quantity_delta),
      'inventory_adjustment',
      'inventory_adjustment',
      adjustment_id
    );
  else
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
      'inventory_adjustment',
      'inventory_adjustment',
      adjustment_id,
      auth.uid()
    );
  end if;

  perform public.record_audit(
    'inventory.adjusted',
    'inventory_adjustment',
    adjustment_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity_delta', quantity_delta)
  );

  return adjustment_id;
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
  left join public.inventory_movements m on m.reference_type = 'receipt' and m.reference_id = r.id
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
  where r.id = target_receipt_id;

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
        where m.reference_type = 'receipt' and m.reference_id = target_receipt_id
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_inventory_adjustments(
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  reason text,
  created_at timestamptz,
  actor_name text,
  item_name text,
  quantity numeric,
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
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:inventory_count') then
    raise exception 'Недостаточно прав для просмотра инвентаризации.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    a.id,
    a.reason,
    a.created_at,
    coalesce(p.full_name, '') as actor_name,
    coalesce(string_agg(distinct i.name, ', '), '') as item_name,
    coalesce(sum(m.quantity), 0) as quantity,
    count(*) over() as total_count
  from public.inventory_adjustments a
  left join public.profiles p on p.id = a.created_by
  left join public.inventory_movements m on m.reference_type = 'inventory_adjustment' and m.reference_id = a.id
  left join public.inventory_items i on i.id = m.item_id
  group by a.id, a.reason, a.created_at, p.full_name
  order by a.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
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
        m.id,
        m.item_id,
        i.name as item_name,
        i.code as item_code,
        i.article as item_article,
        i.barcode as item_barcode,
        coalesce(u.name, '') as unit_name,
        m.quantity,
        m.unit_price,
        m.batch_id,
        b.receipt_date as batch_receipt_date,
        b.supplier as batch_supplier,
        coalesce(p.full_name, '') as actor_name,
        m.created_at
      from public.inventory_movements m
      join public.inventory_items i on i.id = m.item_id
      join public.inventory_batches b on b.id = m.batch_id
      left join public.reference_items u on u.id = i.unit_id
      left join public.profiles p on p.id = m.created_by
      where m.reference_type = 'order' and m.reference_id = target_order_id
    ) x
  ), '[]'::jsonb);
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
    (select count(*) from public.inventory_items where category_id = target_item_id or unit_id = target_item_id)
  )::integer;
$$;

alter table public.inventory_items enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.inventory_sales enable row level security;
alter table public.inventory_adjustments enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select
  on public.inventory_items
  for select
  to authenticated
  using (public.can_read_inventory() or public.has_permission('orders:read') or public.has_permission('orders:update'));

drop policy if exists inventory_receipts_select on public.inventory_receipts;
create policy inventory_receipts_select
  on public.inventory_receipts
  for select
  to authenticated
  using (public.has_permission('inventory:read') or public.has_permission('inventory:receive'));

drop policy if exists inventory_sales_select on public.inventory_sales;
create policy inventory_sales_select
  on public.inventory_sales
  for select
  to authenticated
  using (public.can_read_inventory() or public.has_permission('sales:read'));

drop policy if exists inventory_adjustments_select on public.inventory_adjustments;
create policy inventory_adjustments_select
  on public.inventory_adjustments
  for select
  to authenticated
  using (public.has_permission('inventory:read') or public.has_permission('inventory:inventory_count'));

drop policy if exists inventory_batches_select on public.inventory_batches;
create policy inventory_batches_select
  on public.inventory_batches
  for select
  to authenticated
  using (public.can_read_inventory() or public.has_permission('orders:read'));

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select
  on public.inventory_movements
  for select
  to authenticated
  using (public.can_read_inventory() or public.has_permission('orders:read'));

revoke all on function public.prevent_inventory_movement_mutation() from public;
revoke all on function public.protect_inventory_batch() from public;
revoke all on function public.apply_inventory_movement() from public;
revoke all on function public.assert_inventory_category(uuid) from public;
revoke all on function public.assert_inventory_unit(uuid) from public;
revoke all on function public.can_read_inventory() from public;
revoke all on function public.raise_inventory_name_duplicate(text) from public;
revoke all on function public.consume_inventory_fifo(uuid, numeric, text, text, uuid) from public;
revoke all on function public.create_inventory_item(text, text, text, text, uuid, uuid, numeric, numeric, numeric) from public;
revoke all on function public.update_inventory_item(uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric) from public;
revoke all on function public.search_inventory_items(text, integer, integer) from public;
revoke all on function public.find_inventory_item_by_name(text, uuid) from public;
revoke all on function public.find_inventory_items_by_barcode(text) from public;
revoke all on function public.receive_inventory(text, date, text, jsonb) from public;
revoke all on function public.consume_inventory_for_order(uuid, uuid, numeric) from public;
revoke all on function public.consume_inventory_for_sale(uuid, numeric, text, text) from public;
revoke all on function public.adjust_inventory(uuid, numeric, text) from public;
revoke all on function public.get_inventory_item_card(uuid) from public;
revoke all on function public.list_inventory_receipts(integer, integer) from public;
revoke all on function public.get_inventory_receipt(uuid) from public;
revoke all on function public.list_inventory_adjustments(integer, integer) from public;
revoke all on function public.get_order_inventory_usage(uuid) from public;

grant execute on function public.create_inventory_item(text, text, text, text, uuid, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.update_inventory_item(uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.search_inventory_items(text, integer, integer) to authenticated;
grant execute on function public.find_inventory_item_by_name(text, uuid) to authenticated;
grant execute on function public.find_inventory_items_by_barcode(text) to authenticated;
grant execute on function public.receive_inventory(text, date, text, jsonb) to authenticated;
grant execute on function public.consume_inventory_for_order(uuid, uuid, numeric) to authenticated;
grant execute on function public.consume_inventory_for_sale(uuid, numeric, text, text) to authenticated;
grant execute on function public.adjust_inventory(uuid, numeric, text) to authenticated;
grant execute on function public.get_inventory_item_card(uuid) to authenticated;
grant execute on function public.list_inventory_receipts(integer, integer) to authenticated;
grant execute on function public.get_inventory_receipt(uuid) to authenticated;
grant execute on function public.list_inventory_adjustments(integer, integer) to authenticated;
grant execute on function public.get_order_inventory_usage(uuid) to authenticated;
