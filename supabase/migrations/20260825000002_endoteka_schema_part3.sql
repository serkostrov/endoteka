-- =============================================================================
-- Эндотека: schema squash — часть 3/3
-- Секции исходных миграций: [92/151] … [151/151]
-- Файлы: 20260829700000_no_negative_stock.sql … 20261029120000_order_attachments_allow_imported_mimes.sql
-- Размер части: ~414 KiB
--
-- Применять строго по порядку: part1 → part2 → part3
-- на чистой БД (SQL Editor / psql -v ON_ERROR_STOP=1).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- [1/60 | was 92/151] 20260829700000_no_negative_stock.sql
-- -----------------------------------------------------------------------------

-- Остаток никогда не уходит в минус: запрет недостачи при списании и выравнивание текущих минусов.

-- 1) Закрыть существующие отрицательные партии (недостачи).
do $$
declare
  batch_row record;
  adj_id uuid;
begin
  for batch_row in
    select
      b.id,
      b.item_id,
      b.remaining_quantity,
      b.purchase_price
    from public.inventory_batches b
    where b.remaining_quantity < 0
    order by b.created_at, b.id
    for update
  loop
    insert into public.inventory_adjustments (reason, created_by)
    values ('Выравнивание отрицательного остатка', auth.uid())
    returning id into adj_id;

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
      batch_row.item_id,
      batch_row.id,
      -batch_row.remaining_quantity,
      coalesce(batch_row.purchase_price, 0),
      'inventory_adjustment',
      'inventory_adjustment',
      adj_id,
      auth.uid()
    );
  end loop;
end;
$$;

-- 2) Триггер: движение не может опустить remaining_quantity ниже нуля.
create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_remaining numeric;
begin
  update public.inventory_batches
  set remaining_quantity = remaining_quantity + new.quantity
  where id = new.batch_id
  returning remaining_quantity into next_remaining;

  if not found then
    raise exception 'Партия не найдена.';
  end if;

  if next_remaining < 0 then
    raise exception 'Остаток не может быть отрицательным.';
  end if;

  return new;
end;
$$;

-- 3) FIFO без режима недостачи.
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
  movement_id uuid;
  lines jsonb := '[]'::jsonb;
begin
  if consume_quantity is null or consume_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  -- Недостача запрещена: параметр оставлен только для совместимости сигнатуры.
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
    raise exception 'Недостаточно остатка. Доступно: %, запрошено: %.', available, consume_quantity;
  end if;

  return jsonb_build_object(
    'item_id', target_item_id,
    'quantity', consume_quantity,
    'lines', lines
  );
end;
$$;

-- 4) Заказы: списание только при наличии остатка.
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
    false
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
        false
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
      'unit_price', line_unit_price
    )
  );
end;
$$;

-- 5) Жёсткое ограничение на уровне таблицы (после выравнивания данных).
alter table public.inventory_batches
  drop constraint if exists inventory_batches_remaining_non_negative;

alter table public.inventory_batches
  add constraint inventory_batches_remaining_non_negative
  check (remaining_quantity >= 0);

-- -----------------------------------------------------------------------------
-- [2/60 | was 93/151] 20260829710000_unify_stock_qty.sql
-- -----------------------------------------------------------------------------

-- Единый источник остатка: remaining_quantity = сумма движений по партии.
-- inventory_item_stock_qty считает так же, как список склада.

do $$
declare
  batch_row record;
  mov_sum numeric;
  adj_id uuid;
  cover numeric;
begin
  for batch_row in
    select b.id, b.item_id, b.remaining_quantity, b.purchase_price
    from public.inventory_batches b
    order by b.created_at, b.id
    for update
  loop
    select coalesce(sum(m.quantity), 0)
      into mov_sum
    from public.inventory_movements m
    where m.batch_id = batch_row.id;

    if mov_sum < 0 then
      cover := -mov_sum;
      insert into public.inventory_adjustments (reason, created_by)
      values ('Синхронизация остатка партии', auth.uid())
      returning id into adj_id;

      insert into public.inventory_movements (
        item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
      )
      values (
        batch_row.item_id,
        batch_row.id,
        cover,
        coalesce(batch_row.purchase_price, 0),
        'inventory_adjustment',
        'inventory_adjustment',
        adj_id,
        auth.uid()
      );
    end if;

    select coalesce(sum(m.quantity), 0)
      into mov_sum
    from public.inventory_movements m
    where m.batch_id = batch_row.id;

    if mov_sum < 0 then
      mov_sum := 0;
    end if;

    if batch_row.remaining_quantity is distinct from mov_sum then
      update public.inventory_batches
      set remaining_quantity = mov_sum
      where id = batch_row.id;
    end if;
  end loop;
end;
$$;

create or replace function public.inventory_item_stock_qty(target_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(b.remaining_quantity), 0)
  from public.inventory_batches b
  where b.item_id = target_item_id;
$$;

revoke all on function public.inventory_item_stock_qty(uuid) from public;
grant execute on function public.inventory_item_stock_qty(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [3/60 | was 94/151] 20260829720000_integer_quantities.sql
-- -----------------------------------------------------------------------------

-- Количество деталей, работ и услуг — только целые числа.
-- Движения и «жёсткие» поля партии защищены триггерами — отключаем на время правки.

alter table public.inventory_movements disable trigger inventory_movements_immutable;
alter table public.inventory_batches disable trigger inventory_batches_protect;

-- Дробные «пылинки» (|q| < 0.5) при round дают 0 и ломают check quantity <> 0 — удаляем.
delete from public.sale_allocations
where abs(quantity) < 0.5
   or movement_id in (
     select id from public.inventory_movements where abs(quantity) < 0.5
   );

delete from public.inventory_movements
where abs(quantity) < 0.5;

-- 1) Округлить остальные дробные значения
update public.inventory_movements
set quantity = round(quantity)
where quantity is distinct from round(quantity);

update public.inventory_batches
set
  quantity = greatest(1, round(quantity)),
  remaining_quantity = greatest(0, round(remaining_quantity))
where quantity is distinct from round(quantity)
   or remaining_quantity is distinct from round(remaining_quantity);

-- Синхронизация остатка партии с журналом после правок движений
update public.inventory_batches b
set remaining_quantity = greatest(
  0,
  coalesce((
    select sum(m.quantity)
    from public.inventory_movements m
    where m.batch_id = b.id
  ), 0)
);

-- Партия не может иметь remaining > quantity
update public.inventory_batches
set quantity = greatest(remaining_quantity, 1)
where remaining_quantity > quantity;

-- Партии без движений и с нулевым остатком: quantity минимум 1 (check quantity > 0)
update public.inventory_batches
set quantity = greatest(quantity, 1)
where quantity < 1;

alter table public.inventory_movements enable trigger inventory_movements_immutable;
alter table public.inventory_batches enable trigger inventory_batches_protect;

update public.sale_lines
set quantity = greatest(1, round(quantity))
where quantity is distinct from round(quantity);

update public.sale_allocations
set quantity = greatest(1, round(quantity))
where quantity is distinct from round(quantity);

update public.order_part_lines
set quantity = greatest(1, round(quantity))
where quantity is distinct from round(quantity);

update public.order_service_lines
set quantity = greatest(1, round(quantity))
where quantity is distinct from round(quantity);

update public.inventory_count_lines
set
  expected_quantity = greatest(0, round(expected_quantity)),
  actual_quantity = case
    when actual_quantity is null then null
    else greatest(0, round(actual_quantity))
  end
where expected_quantity is distinct from round(expected_quantity)
   or (actual_quantity is not null and actual_quantity is distinct from round(actual_quantity));

-- 2) Сузить типы колонок до целых numeric(14,0)
alter table public.inventory_batches
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity)),
  alter column remaining_quantity type numeric(14, 0) using greatest(0, round(remaining_quantity));

alter table public.inventory_movements
  alter column quantity type numeric(14, 0) using (
    case
      when round(quantity) = 0 then sign(quantity)
      else round(quantity)
    end
  );

-- amount зависит от quantity — снимаем generated, меняем тип, возвращаем
alter table public.sale_lines
  drop column if exists amount;

alter table public.sale_lines
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity));

alter table public.sale_lines
  add column amount numeric(14, 2)
    generated always as (round((quantity * unit_price)::numeric, 2)) stored;

alter table public.sale_allocations
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity));

alter table public.order_part_lines
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity));

alter table public.order_service_lines
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity));

-- generated difference зависит от типов actual/expected — пересоздаём
alter table public.inventory_count_lines
  drop column if exists difference;

alter table public.inventory_count_lines
  alter column expected_quantity type numeric(14, 0) using greatest(0, round(expected_quantity)),
  alter column actual_quantity type numeric(14, 0) using (
    case
      when actual_quantity is null then null
      else greatest(0, round(actual_quantity))
    end
  );

alter table public.inventory_count_lines
  add column difference numeric(14, 0)
    generated always as (actual_quantity - expected_quantity) stored;

-- -----------------------------------------------------------------------------
-- [4/60 | was 95/151] 20260829730000_order_usage_stock_qty.sql
-- -----------------------------------------------------------------------------

-- Остаток склада в составе работ — для ограничения количества в UI.

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
        case
          when l.item_id is null then null
          else coalesce((
            select sum(b.remaining_quantity)
            from public.inventory_batches b
            where b.item_id = l.item_id
          ), 0)
        end as stock_quantity,
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

-- -----------------------------------------------------------------------------
-- [5/60 | was 96/151] 20260829740000_order_work_fields_permission.sql
-- -----------------------------------------------------------------------------

-- Поля раздела order_work живут на заказе.
-- Прав order_work:read / order_work:update в системе нет → используем orders:*.

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
  elsif target_entity_code = 'inventory' then
    permission_code := 'inventory:receive';
  elsif target_entity_code = 'order_work' then
    permission_code := 'orders:update';
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

-- Чтение: order_work → orders:read (иначе значения в «Составе работы» не подгружаются).
drop policy if exists dynamic_field_values_select_entity_read on public.dynamic_field_values;
create policy dynamic_field_values_select_entity_read
  on public.dynamic_field_values
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('settings:read')
      or public.has_permission(
        case
          when entity_code = 'order_work' then 'orders:read'
          else entity_code || ':read'
        end
      )
    )
  );

-- -----------------------------------------------------------------------------
-- [6/60 | was 97/151] 20260829750000_inventory_stock_filter_in_stock.sql
-- -----------------------------------------------------------------------------

-- Фильтр склада: «В наличии» (остаток > 0).

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
    and (stock_value <> 'zero' or coalesce(stock.qty, 0) <= 0)
    and (stock_value <> 'in_stock' or coalesce(stock.qty, 0) > 0)
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.search_inventory_items(text, integer, integer, text) from public, anon;
grant execute on function public.search_inventory_items(text, integer, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [7/60 | was 98/151] 20260829760000_inventory_item_history.sql
-- -----------------------------------------------------------------------------

-- История позиции: агрегация по документам, контрагент, корректные продажи (public.sales).

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

-- -----------------------------------------------------------------------------
-- [8/60 | was 99/151] 20260829770000_fix_write_off_reference_type.sql
-- -----------------------------------------------------------------------------

-- Списание: reference_type inventory_write_off не был в check constraint.
-- Из‑за этого create_inventory_write_off падал при insert в inventory_movements.

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

-- -----------------------------------------------------------------------------
-- [9/60 | was 100/151] 20260829780000_company_logo.sql
-- -----------------------------------------------------------------------------

-- Настраиваемый логотип компании: бакет, настройки, RPC.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logo',
  'company-logo',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.app_settings (key, value)
values ('company_logo', jsonb_build_object('path', ''))
on conflict (key) do nothing;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select
  on public.app_settings
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('settings:read')
      or key = 'company_logo'
      or (
        key in ('order_number', 'deadline')
        and (
          public.has_permission('orders:read')
          or public.has_permission('orders:create')
        )
      )
    )
  );

drop policy if exists company_logo_select on storage.objects;
create policy company_logo_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'company-logo');

drop policy if exists company_logo_insert on storage.objects;
create policy company_logo_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'company-logo'
    and public.has_permission('settings:update')
  );

drop policy if exists company_logo_update on storage.objects;
create policy company_logo_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'company-logo'
    and public.has_permission('settings:update')
  )
  with check (
    bucket_id = 'company-logo'
    and public.has_permission('settings:update')
  );

drop policy if exists company_logo_delete on storage.objects;
create policy company_logo_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'company-logo'
    and public.has_permission('settings:update')
  );

create or replace function public.get_company_logo()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  logo_path text;
begin
  if not public.is_active_user() then
    raise exception 'Нужна авторизация.';
  end if;

  select nullif(btrim(coalesce(value ->> 'path', '')), '')
    into logo_path
  from public.app_settings
  where key = 'company_logo';

  return logo_path;
end;
$$;

create or replace function public.set_company_logo(file_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
  safe_path text;
begin
  perform public.assert_settings_write();

  safe_path := btrim(coalesce(file_path, ''));
  if safe_path = '' then
    raise exception 'Не указан файл логотипа.';
  end if;

  if position('..' in safe_path) > 0 or left(safe_path, 1) = '/' then
    raise exception 'Некорректный путь логотипа.';
  end if;

  select nullif(btrim(coalesce(value ->> 'path', '')), '')
    into old_path
  from public.app_settings
  where key = 'company_logo';

  insert into public.app_settings (key, value)
  values ('company_logo', jsonb_build_object('path', safe_path))
  on conflict (key) do update
    set value = excluded.value;

  perform public.record_audit(
    'settings.company_logo_updated',
    'app_settings',
    'company_logo',
    jsonb_build_object('path', safe_path)
  );

  return old_path;
end;
$$;

create or replace function public.clear_company_logo()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  old_path text;
begin
  perform public.assert_settings_write();

  select nullif(btrim(coalesce(value ->> 'path', '')), '')
    into old_path
  from public.app_settings
  where key = 'company_logo';

  insert into public.app_settings (key, value)
  values ('company_logo', jsonb_build_object('path', ''))
  on conflict (key) do update
    set value = excluded.value;

  perform public.record_audit(
    'settings.company_logo_cleared',
    'app_settings',
    'company_logo',
    '{}'::jsonb
  );

  return old_path;
end;
$$;

revoke all on function public.get_company_logo() from public;
revoke all on function public.set_company_logo(text) from public;
revoke all on function public.clear_company_logo() from public;

grant execute on function public.get_company_logo() to authenticated;
grant execute on function public.set_company_logo(text) to authenticated;
grant execute on function public.clear_company_logo() to authenticated;

-- -----------------------------------------------------------------------------
-- [10/60 | was 101/151] 20260829790000_order_number_format_a.sql
-- -----------------------------------------------------------------------------

-- Формат номера заказа: А0001 (префикс + цифры, без дефиса).
-- Уже выданные номера не меняются; новые выдаются в новом формате.

create or replace function public.next_order_number()
returns table (order_number text, seq integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_val integer;
  current_prefix text;
  current_pad integer;
begin
  update public.order_number_sequence
  set last_value = greatest(last_value, start_value - 1) + 1
  where id = 1
  returning last_value, prefix, pad_width into next_val, current_prefix, current_pad;

  if next_val is null then
    raise exception 'Не настроена нумерация заказов.';
  end if;

  order_number := current_prefix || lpad(next_val::text, current_pad, '0');
  seq := next_val;
  return next;
end;
$$;

create or replace function public.preview_next_order_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select prefix || lpad((greatest(last_value, start_value - 1) + 1)::text, pad_width, '0')
  from public.order_number_sequence
  where id = 1;
$$;

update public.order_number_sequence
set prefix = 'А'
where id = 1;

update public.app_settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{prefix}', '"А"'::jsonb)
where key = 'order_number';

alter table public.order_number_sequence
  alter column prefix set default 'А';

-- -----------------------------------------------------------------------------
-- [11/60 | was 102/151] 20260829800000_device_compatible_parts.sql
-- -----------------------------------------------------------------------------

-- Совместимые детали номенклатуры для видов приборов (модель / модификация и др.).

create table if not exists public.device_compatible_parts (
  id uuid primary key default gen_random_uuid(),
  reference_item_id uuid not null references public.reference_items (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint device_compatible_parts_unique unique (reference_item_id, item_id)
);

create index if not exists device_compatible_parts_reference_idx
  on public.device_compatible_parts (reference_item_id, sort_order, created_at);

create index if not exists device_compatible_parts_item_idx
  on public.device_compatible_parts (item_id);

alter table public.device_compatible_parts enable row level security;

drop policy if exists device_compatible_parts_select on public.device_compatible_parts;
create policy device_compatible_parts_select
  on public.device_compatible_parts
  for select
  to authenticated
  using (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  );

create or replace function public.list_device_compatible_parts(target_reference_item_id uuid)
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
  cover_file_path text,
  link_id uuid,
  sort_order integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  ) then
    raise exception 'Недостаточно прав для просмотра подходящих деталей.';
  end if;

  if target_reference_item_id is null then
    raise exception 'Не указан вид прибора.';
  end if;

  return query
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '')::text as category_name,
    i.unit_id,
    coalesce(u.name, '')::text as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    public.inventory_item_stock_qty(i.id) as stock_quantity,
    (
      select p.file_path
      from public.inventory_item_photos p
      where p.item_id = i.id
      order by p.sort_order, p.created_at
      limit 1
    ) as cover_file_path,
    link.id as link_id,
    link.sort_order,
    link.created_at
  from public.device_compatible_parts link
  join public.inventory_items i on i.id = link.item_id
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where link.reference_item_id = target_reference_item_id
  order by link.sort_order, i.name, link.created_at;
end;
$$;

create or replace function public.add_device_compatible_part(
  target_reference_item_id uuid,
  target_item_id uuid
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
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения подходящих деталей.';
  end if;

  if target_reference_item_id is null or not exists (
    select 1 from public.reference_items where id = target_reference_item_id
  ) then
    raise exception 'Вид прибора не найден.';
  end if;

  if target_item_id is null or not exists (
    select 1 from public.inventory_items where id = target_item_id
  ) then
    raise exception 'Позиция номенклатуры не найдена.';
  end if;

  select coalesce(max(sort_order), 0) + 1
    into next_order
  from public.device_compatible_parts
  where reference_item_id = target_reference_item_id;

  insert into public.device_compatible_parts (
    reference_item_id, item_id, sort_order, created_by
  )
  values (
    target_reference_item_id, target_item_id, next_order, auth.uid()
  )
  on conflict (reference_item_id, item_id) do update
    set sort_order = public.device_compatible_parts.sort_order
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.remove_device_compatible_part(
  target_reference_item_id uuid,
  target_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения подходящих деталей.';
  end if;

  delete from public.device_compatible_parts
  where reference_item_id = target_reference_item_id
    and item_id = target_item_id;

  if not found then
    raise exception 'Связь с деталью не найдена.';
  end if;
end;
$$;

revoke all on function public.list_device_compatible_parts(uuid) from public, anon;
revoke all on function public.add_device_compatible_part(uuid, uuid) from public, anon;
revoke all on function public.remove_device_compatible_part(uuid, uuid) from public, anon;

grant execute on function public.list_device_compatible_parts(uuid) to authenticated;
grant execute on function public.add_device_compatible_part(uuid, uuid) to authenticated;
grant execute on function public.remove_device_compatible_part(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [12/60 | was 103/151] 20260829810000_reference_item_photos.sql
-- -----------------------------------------------------------------------------

-- Фото для записей справочника видов приборов (модель / модификация и др.).

create table if not exists public.reference_item_photos (
  id uuid primary key default gen_random_uuid(),
  reference_item_id uuid not null references public.reference_items (id) on delete cascade,
  file_path text not null,
  file_name text not null default '',
  mime_type text not null default 'image/jpeg',
  file_size integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists reference_item_photos_item_idx
  on public.reference_item_photos (reference_item_id, sort_order, created_at);

alter table public.reference_item_photos enable row level security;

drop policy if exists reference_item_photos_select on public.reference_item_photos;
create policy reference_item_photos_select
  on public.reference_item_photos
  for select
  to authenticated
  using (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reference-item-photos',
  'reference-item-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do nothing;

drop policy if exists reference_item_photos_select on storage.objects;
create policy reference_item_photos_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'reference-item-photos'
    and (
      public.has_permission('devices:read')
      or public.has_permission('settings:update')
      or public.can_read_inventory()
      or public.has_permission('orders:read')
    )
  );

drop policy if exists reference_item_photos_insert on storage.objects;
create policy reference_item_photos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'reference-item-photos'
    and public.has_permission('settings:update')
  );

drop policy if exists reference_item_photos_delete on storage.objects;
create policy reference_item_photos_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'reference-item-photos'
    and public.has_permission('settings:update')
  );

create or replace function public.list_reference_item_photos(target_reference_item_id uuid)
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
  if not (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  ) then
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
  from public.reference_item_photos p
  where p.reference_item_id = target_reference_item_id
  order by p.sort_order, p.created_at;
end;
$$;

create or replace function public.register_reference_item_photo(
  target_reference_item_id uuid,
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
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для загрузки фото.';
  end if;

  if not exists (select 1 from public.reference_items where id = target_reference_item_id) then
    raise exception 'Запись справочника не найдена.';
  end if;

  if btrim(coalesce(file_path, '')) = '' then
    raise exception 'Не указан файл.';
  end if;

  if split_part(file_path, '/', 1) <> target_reference_item_id::text then
    raise exception 'Некорректный путь файла.';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into next_order
  from public.reference_item_photos
  where reference_item_id = target_reference_item_id;

  insert into public.reference_item_photos (
    reference_item_id, file_path, file_name, mime_type, file_size, sort_order, created_by
  )
  values (
    target_reference_item_id,
    file_path,
    coalesce(file_name, ''),
    coalesce(mime_type, 'image/jpeg'),
    coalesce(file_size, 0),
    next_order,
    auth.uid()
  )
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.delete_reference_item_photo(target_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_item_photos%rowtype;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для удаления фото.';
  end if;

  select * into current_row
  from public.reference_item_photos
  where id = target_photo_id
  for update;

  if not found then
    raise exception 'Фото не найдено.';
  end if;

  delete from public.reference_item_photos
  where id = target_photo_id;

  return current_row.file_path;
end;
$$;

create or replace function public.set_reference_item_photo_cover(target_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_item_photos%rowtype;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения фото.';
  end if;

  select * into current_row
  from public.reference_item_photos
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
    from public.reference_item_photos p
    where p.reference_item_id = current_row.reference_item_id
  )
  update public.reference_item_photos p
  set sort_order = ordered.new_order
  from ordered
  where p.id = ordered.id;
end;
$$;

revoke all on function public.list_reference_item_photos(uuid) from public, anon;
revoke all on function public.register_reference_item_photo(uuid, text, text, text, integer) from public, anon;
revoke all on function public.delete_reference_item_photo(uuid) from public, anon;
revoke all on function public.set_reference_item_photo_cover(uuid) from public, anon;

grant execute on function public.list_reference_item_photos(uuid) to authenticated;
grant execute on function public.register_reference_item_photo(uuid, text, text, text, integer) to authenticated;
grant execute on function public.delete_reference_item_photo(uuid) to authenticated;
grant execute on function public.set_reference_item_photo_cover(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [13/60 | was 104/151] 20260829820000_list_item_compatible_types.sql
-- -----------------------------------------------------------------------------

-- Обратная выборка: подходящие виды приборов для позиции номенклатуры.
-- Та же таблица device_compatible_parts — синхронизация с карточкой вида.

create or replace function public.list_inventory_item_compatible_types(target_item_id uuid)
returns table (
  id uuid,
  code text,
  name text,
  set_code text,
  set_name text,
  path_label text,
  cover_file_path text,
  link_id uuid,
  sort_order integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  ) then
    raise exception 'Недостаточно прав для просмотра подходящих приборов.';
  end if;

  if target_item_id is null then
    raise exception 'Не указана позиция номенклатуры.';
  end if;

  return query
  select
    ri.id,
    ri.code,
    ri.name,
    rs.code::text as set_code,
    rs.name::text as set_name,
    case rs.code
      when 'device_modifications' then
        concat_ws(' · ', nullif(btrim(great.name), ''), nullif(btrim(grand.name), ''), nullif(btrim(parent.name), ''), ri.name)
      when 'device_models' then
        concat_ws(' · ', nullif(btrim(grand.name), ''), nullif(btrim(parent.name), ''), ri.name)
      when 'device_brands' then
        concat_ws(' · ', nullif(btrim(parent.name), ''), ri.name)
      else ri.name
    end as path_label,
    (
      select p.file_path
      from public.reference_item_photos p
      where p.reference_item_id = ri.id
      order by p.sort_order, p.created_at
      limit 1
    ) as cover_file_path,
    link.id as link_id,
    link.sort_order,
    link.created_at
  from public.device_compatible_parts link
  join public.reference_items ri on ri.id = link.reference_item_id
  join public.reference_sets rs on rs.id = ri.set_id
  left join public.reference_items parent on parent.id = ri.parent_id
  left join public.reference_items grand on grand.id = parent.parent_id
  left join public.reference_items great on great.id = grand.parent_id
  where link.item_id = target_item_id
  order by link.sort_order, ri.name, link.created_at;
end;
$$;

revoke all on function public.list_inventory_item_compatible_types(uuid) from public, anon;
grant execute on function public.list_inventory_item_compatible_types(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [14/60 | was 105/151] 20260829830000_device_card_fields_on_types.sql
-- -----------------------------------------------------------------------------

-- Доп. поля «Приборы» заполняются и на карточке вида (reference_items).
-- При удалении вида очищаем значения; чтение/запись — через devices:* и settings:*.

update public.field_entities
set description = 'Дополнительные поля вида и экземпляра прибора'
where code = 'devices';

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
  elsif target_entity_code = 'inventory' then
    permission_code := 'inventory:receive';
  elsif target_entity_code = 'order_work' then
    permission_code := 'orders:update';
  elsif target_entity_code = 'devices' then
    -- Вид правится через settings; экземпляр — через devices:update.
    if not (
      public.has_permission('devices:update')
      or public.has_permission('settings:update')
    ) then
      raise exception 'Недостаточно прав для сохранения полей.';
    end if;
    permission_code := null;
  end if;

  if permission_code is not null and not public.has_permission(permission_code) then
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

  delete from public.dynamic_field_values
  where entity_code = 'devices'
    and record_id = target_id;

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
-- [15/60 | was 106/151] 20260829840000_compatible_part_groups.sql
-- -----------------------------------------------------------------------------

-- Группы подходящих запчастей на карточке вида прибора + порядок внутри группы.

create table if not exists public.device_compatible_part_groups (
  id uuid primary key default gen_random_uuid(),
  reference_item_id uuid not null references public.reference_items (id) on delete cascade,
  name text not null,
  color text not null default '#2563eb',
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint device_compatible_part_groups_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint device_compatible_part_groups_color_format check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create index if not exists device_compatible_part_groups_reference_idx
  on public.device_compatible_part_groups (reference_item_id, sort_order, created_at);

alter table public.device_compatible_parts
  add column if not exists group_id uuid references public.device_compatible_part_groups (id) on delete cascade;

create index if not exists device_compatible_parts_group_idx
  on public.device_compatible_parts (group_id, sort_order, created_at);

-- Для уже связанных деталей создаём группу «Основные» на каждом виде.
insert into public.device_compatible_part_groups (reference_item_id, name, color, sort_order, created_by)
select distinct
  link.reference_item_id,
  'Основные',
  '#2563eb',
  0,
  auth.uid()
from public.device_compatible_parts link
where link.group_id is null
  and not exists (
    select 1
    from public.device_compatible_part_groups g
    where g.reference_item_id = link.reference_item_id
  );

update public.device_compatible_parts link
set group_id = g.id
from public.device_compatible_part_groups g
where link.group_id is null
  and g.reference_item_id = link.reference_item_id;

alter table public.device_compatible_parts
  alter column group_id set not null;

alter table public.device_compatible_part_groups enable row level security;

drop policy if exists device_compatible_part_groups_select on public.device_compatible_part_groups;
create policy device_compatible_part_groups_select
  on public.device_compatible_part_groups
  for select
  to authenticated
  using (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  );

create or replace function public.list_device_compatible_part_groups(target_reference_item_id uuid)
returns table (
  id uuid,
  reference_item_id uuid,
  name text,
  color text,
  sort_order integer,
  part_count integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  ) then
    raise exception 'Недостаточно прав для просмотра групп деталей.';
  end if;

  if target_reference_item_id is null then
    raise exception 'Не указан вид прибора.';
  end if;

  return query
  select
    g.id,
    g.reference_item_id,
    g.name,
    g.color,
    g.sort_order,
    (
      select count(*)::integer
      from public.device_compatible_parts p
      where p.group_id = g.id
    ) as part_count,
    g.created_at
  from public.device_compatible_part_groups g
  where g.reference_item_id = target_reference_item_id
  order by g.sort_order, g.created_at;
end;
$$;

create or replace function public.upsert_device_compatible_part_group(
  target_id uuid,
  target_reference_item_id uuid,
  target_name text,
  target_color text default '#2563eb'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
  cleaned_name text := btrim(coalesce(target_name, ''));
  cleaned_color text := upper(coalesce(nullif(btrim(target_color), ''), '#2563EB'));
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения групп деталей.';
  end if;

  if target_reference_item_id is null or not exists (
    select 1 from public.reference_items where id = target_reference_item_id
  ) then
    raise exception 'Вид прибора не найден.';
  end if;

  if cleaned_name = '' then
    raise exception 'Укажите название группы.';
  end if;

  if cleaned_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Цвет группы задан некорректно.';
  end if;

  if target_id is null then
    select coalesce(max(sort_order), -1) + 1
      into next_order
    from public.device_compatible_part_groups
    where reference_item_id = target_reference_item_id;

    insert into public.device_compatible_part_groups (
      reference_item_id, name, color, sort_order, created_by
    )
    values (
      target_reference_item_id, cleaned_name, cleaned_color, next_order, auth.uid()
    )
    returning id into result_id;
  else
    update public.device_compatible_part_groups
    set name = cleaned_name,
        color = cleaned_color
    where id = target_id
      and reference_item_id = target_reference_item_id
    returning id into result_id;

    if result_id is null then
      raise exception 'Группа не найдена.';
    end if;
  end if;

  return result_id;
end;
$$;

create or replace function public.delete_device_compatible_part_group(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  part_count integer;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения групп деталей.';
  end if;

  if not exists (select 1 from public.device_compatible_part_groups where id = target_id) then
    raise exception 'Группа не найдена.';
  end if;

  select count(*) into part_count
  from public.device_compatible_parts
  where group_id = target_id;

  if part_count > 0 then
    raise exception 'Сначала уберите детали из группы.';
  end if;

  delete from public.device_compatible_part_groups where id = target_id;
end;
$$;

create or replace function public.reorder_device_compatible_part_groups(
  target_reference_item_id uuid,
  group_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения групп деталей.';
  end if;

  if group_ids is null or array_length(group_ids, 1) is null then
    raise exception 'Передайте порядок групп.';
  end if;

  select count(*) into expected_count
  from public.device_compatible_part_groups
  where reference_item_id = target_reference_item_id;

  select count(*) into matched_count
  from public.device_compatible_part_groups
  where reference_item_id = target_reference_item_id
    and id = any (group_ids);

  if expected_count <> array_length(group_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все группы этого вида.';
  end if;

  update public.device_compatible_part_groups g
  set sort_order = o.ord - 1
  from unnest(group_ids) with ordinality as o(id, ord)
  where g.id = o.id
    and g.reference_item_id = target_reference_item_id;
end;
$$;

create or replace function public.reorder_device_compatible_parts(
  target_group_id uuid,
  link_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения подходящих деталей.';
  end if;

  if target_group_id is null or not exists (
    select 1 from public.device_compatible_part_groups where id = target_group_id
  ) then
    raise exception 'Группа не найдена.';
  end if;

  if link_ids is null or array_length(link_ids, 1) is null then
    raise exception 'Передайте порядок деталей.';
  end if;

  select count(*) into expected_count
  from public.device_compatible_parts
  where group_id = target_group_id;

  select count(*) into matched_count
  from public.device_compatible_parts
  where group_id = target_group_id
    and id = any (link_ids);

  if expected_count <> array_length(link_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все детали группы.';
  end if;

  update public.device_compatible_parts p
  set sort_order = o.ord - 1
  from unnest(link_ids) with ordinality as o(id, ord)
  where p.id = o.id
    and p.group_id = target_group_id;
end;
$$;

drop function if exists public.list_device_compatible_parts(uuid);
create or replace function public.list_device_compatible_parts(target_reference_item_id uuid)
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
  cover_file_path text,
  link_id uuid,
  group_id uuid,
  group_name text,
  group_color text,
  group_sort_order integer,
  sort_order integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('devices:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  ) then
    raise exception 'Недостаточно прав для просмотра подходящих деталей.';
  end if;

  if target_reference_item_id is null then
    raise exception 'Не указан вид прибора.';
  end if;

  return query
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '')::text as category_name,
    i.unit_id,
    coalesce(u.name, '')::text as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    public.inventory_item_stock_qty(i.id) as stock_quantity,
    (
      select p.file_path
      from public.inventory_item_photos p
      where p.item_id = i.id
      order by p.sort_order, p.created_at
      limit 1
    ) as cover_file_path,
    link.id as link_id,
    g.id as group_id,
    g.name as group_name,
    g.color as group_color,
    g.sort_order as group_sort_order,
    link.sort_order,
    link.created_at
  from public.device_compatible_parts link
  join public.device_compatible_part_groups g on g.id = link.group_id
  join public.inventory_items i on i.id = link.item_id
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where link.reference_item_id = target_reference_item_id
  order by g.sort_order, link.sort_order, i.name, link.created_at;
end;
$$;

drop function if exists public.add_device_compatible_part(uuid, uuid);
create or replace function public.add_device_compatible_part(
  target_reference_item_id uuid,
  target_item_id uuid,
  target_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
  resolved_group_id uuid := target_group_id;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения подходящих деталей.';
  end if;

  if target_reference_item_id is null or not exists (
    select 1 from public.reference_items where id = target_reference_item_id
  ) then
    raise exception 'Вид прибора не найден.';
  end if;

  if target_item_id is null or not exists (
    select 1 from public.inventory_items where id = target_item_id
  ) then
    raise exception 'Позиция номенклатуры не найдена.';
  end if;

  if resolved_group_id is null then
    select g.id
      into resolved_group_id
    from public.device_compatible_part_groups g
    where g.reference_item_id = target_reference_item_id
    order by g.sort_order, g.created_at
    limit 1;

    if resolved_group_id is null then
      insert into public.device_compatible_part_groups (
        reference_item_id, name, color, sort_order, created_by
      )
      values (
        target_reference_item_id, 'Основные', '#2563eb', 0, auth.uid()
      )
      returning id into resolved_group_id;
    end if;
  else
    if not exists (
      select 1
      from public.device_compatible_part_groups
      where id = resolved_group_id
        and reference_item_id = target_reference_item_id
    ) then
      raise exception 'Группа не найдена для этого вида прибора.';
    end if;
  end if;

  select coalesce(max(sort_order), -1) + 1
    into next_order
  from public.device_compatible_parts
  where group_id = resolved_group_id;

  insert into public.device_compatible_parts (
    reference_item_id, item_id, group_id, sort_order, created_by
  )
  values (
    target_reference_item_id, target_item_id, resolved_group_id, next_order, auth.uid()
  )
  on conflict (reference_item_id, item_id) do update
    set sort_order = public.device_compatible_parts.sort_order,
        group_id = public.device_compatible_parts.group_id
  returning id into result_id;

  return result_id;
end;
$$;

revoke all on function public.list_device_compatible_part_groups(uuid) from public, anon;
revoke all on function public.upsert_device_compatible_part_group(uuid, uuid, text, text) from public, anon;
revoke all on function public.delete_device_compatible_part_group(uuid) from public, anon;
revoke all on function public.reorder_device_compatible_part_groups(uuid, uuid[]) from public, anon;
revoke all on function public.reorder_device_compatible_parts(uuid, uuid[]) from public, anon;
revoke all on function public.list_device_compatible_parts(uuid) from public, anon;
revoke all on function public.add_device_compatible_part(uuid, uuid, uuid) from public, anon;

grant execute on function public.list_device_compatible_part_groups(uuid) to authenticated;
grant execute on function public.upsert_device_compatible_part_group(uuid, uuid, text, text) to authenticated;
grant execute on function public.delete_device_compatible_part_group(uuid) to authenticated;
grant execute on function public.reorder_device_compatible_part_groups(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_device_compatible_parts(uuid, uuid[]) to authenticated;
grant execute on function public.list_device_compatible_parts(uuid) to authenticated;
grant execute on function public.add_device_compatible_part(uuid, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [16/60 | was 107/151] 20260829850000_global_compatible_part_groups.sql
-- -----------------------------------------------------------------------------

-- Группы запасных частей — единый справочник для всех приборов.
-- Порядок деталей внутри группы остаётся индивидуальным для каждого вида.

-- Сводим дубликаты по названию к одной канонической группе.
create temporary table _compatible_group_map on commit drop as
with ranked as (
  select
    id,
    lower(btrim(name)) as name_key,
    row_number() over (
      partition by lower(btrim(name))
      order by sort_order, created_at, id
    ) as rn
  from public.device_compatible_part_groups
)
select
  r.id as old_id,
  k.id as new_id
from ranked r
join ranked k on k.name_key = r.name_key and k.rn = 1;

update public.device_compatible_parts p
set group_id = m.new_id
from _compatible_group_map m
where p.group_id = m.old_id
  and m.old_id <> m.new_id;

delete from public.device_compatible_part_groups g
using _compatible_group_map m
where g.id = m.old_id
  and m.old_id <> m.new_id;

drop index if exists public.device_compatible_part_groups_reference_idx;

alter table public.device_compatible_part_groups
  drop column if exists reference_item_id;

alter table public.device_compatible_part_groups
  drop constraint if exists device_compatible_part_groups_name_unique;

drop index if exists public.device_compatible_part_groups_name_ci_idx;
create unique index device_compatible_part_groups_name_ci_idx
  on public.device_compatible_part_groups (lower(name));

create index if not exists device_compatible_part_groups_sort_idx
  on public.device_compatible_part_groups (sort_order, created_at);

-- Если групп ещё нет — базовая.
insert into public.device_compatible_part_groups (name, color, sort_order)
select 'Основные', '#2563eb', 0
where not exists (select 1 from public.device_compatible_part_groups);

-- Перенумеровать sort_order подряд.
with ordered as (
  select id, row_number() over (order by sort_order, created_at, id) - 1 as next_order
  from public.device_compatible_part_groups
)
update public.device_compatible_part_groups g
set sort_order = o.next_order
from ordered o
where g.id = o.id;

drop function if exists public.list_device_compatible_part_groups(uuid);
drop function if exists public.upsert_device_compatible_part_group(uuid, uuid, text, text);
drop function if exists public.reorder_device_compatible_part_groups(uuid, uuid[]);
drop function if exists public.reorder_device_compatible_parts(uuid, uuid[]);
drop function if exists public.add_device_compatible_part(uuid, uuid, uuid);

create or replace function public.list_device_compatible_part_groups(
  target_reference_item_id uuid default null
)
returns table (
  id uuid,
  name text,
  color text,
  sort_order integer,
  part_count integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('devices:read')
    or public.has_permission('settings:read')
    or public.has_permission('settings:update')
    or public.can_read_inventory()
    or public.has_permission('orders:read')
  ) then
    raise exception 'Недостаточно прав для просмотра групп деталей.';
  end if;

  return query
  select
    g.id,
    g.name,
    g.color,
    g.sort_order,
    (
      select count(*)::integer
      from public.device_compatible_parts p
      where p.group_id = g.id
        and (
          target_reference_item_id is null
          or p.reference_item_id = target_reference_item_id
        )
    ) as part_count,
    g.created_at
  from public.device_compatible_part_groups g
  order by g.sort_order, g.created_at;
end;
$$;

create or replace function public.upsert_device_compatible_part_group(
  target_id uuid,
  target_name text,
  target_color text default '#2563eb'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
  cleaned_name text := btrim(coalesce(target_name, ''));
  cleaned_color text := upper(coalesce(nullif(btrim(target_color), ''), '#2563EB'));
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения групп деталей.';
  end if;

  if cleaned_name = '' then
    raise exception 'Укажите название группы.';
  end if;

  if cleaned_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Цвет группы задан некорректно.';
  end if;

  if exists (
    select 1
    from public.device_compatible_part_groups
    where lower(name) = lower(cleaned_name)
      and (target_id is null or id <> target_id)
  ) then
    raise exception 'Группа с таким названием уже есть.';
  end if;

  if target_id is null then
    select coalesce(max(sort_order), -1) + 1
      into next_order
    from public.device_compatible_part_groups;

    insert into public.device_compatible_part_groups (name, color, sort_order, created_by)
    values (cleaned_name, cleaned_color, next_order, auth.uid())
    returning id into result_id;
  else
    update public.device_compatible_part_groups
    set name = cleaned_name,
        color = cleaned_color
    where id = target_id
    returning id into result_id;

    if result_id is null then
      raise exception 'Группа не найдена.';
    end if;
  end if;

  return result_id;
end;
$$;

create or replace function public.delete_device_compatible_part_group(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  part_count integer;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения групп деталей.';
  end if;

  if not exists (select 1 from public.device_compatible_part_groups where id = target_id) then
    raise exception 'Группа не найдена.';
  end if;

  select count(*) into part_count
  from public.device_compatible_parts
  where group_id = target_id;

  if part_count > 0 then
    raise exception 'Сначала уберите детали из группы на карточках приборов.';
  end if;

  delete from public.device_compatible_part_groups where id = target_id;
end;
$$;

create or replace function public.reorder_device_compatible_part_groups(group_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения групп деталей.';
  end if;

  if group_ids is null or array_length(group_ids, 1) is null then
    raise exception 'Передайте порядок групп.';
  end if;

  select count(*) into expected_count from public.device_compatible_part_groups;

  select count(*) into matched_count
  from public.device_compatible_part_groups
  where id = any (group_ids);

  if expected_count <> array_length(group_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все группы.';
  end if;

  update public.device_compatible_part_groups g
  set sort_order = o.ord - 1
  from unnest(group_ids) with ordinality as o(id, ord)
  where g.id = o.id;
end;
$$;

-- Порядок деталей — только внутри вида прибора + группы.
create or replace function public.reorder_device_compatible_parts(
  target_reference_item_id uuid,
  target_group_id uuid,
  link_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения подходящих деталей.';
  end if;

  if target_reference_item_id is null or not exists (
    select 1 from public.reference_items where id = target_reference_item_id
  ) then
    raise exception 'Вид прибора не найден.';
  end if;

  if target_group_id is null or not exists (
    select 1 from public.device_compatible_part_groups where id = target_group_id
  ) then
    raise exception 'Группа не найдена.';
  end if;

  if link_ids is null or array_length(link_ids, 1) is null then
    raise exception 'Передайте порядок деталей.';
  end if;

  select count(*) into expected_count
  from public.device_compatible_parts
  where reference_item_id = target_reference_item_id
    and group_id = target_group_id;

  select count(*) into matched_count
  from public.device_compatible_parts
  where reference_item_id = target_reference_item_id
    and group_id = target_group_id
    and id = any (link_ids);

  if expected_count <> array_length(link_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все детали группы на этой карточке.';
  end if;

  update public.device_compatible_parts p
  set sort_order = o.ord - 1
  from unnest(link_ids) with ordinality as o(id, ord)
  where p.id = o.id
    and p.reference_item_id = target_reference_item_id
    and p.group_id = target_group_id;
end;
$$;

create or replace function public.add_device_compatible_part(
  target_reference_item_id uuid,
  target_item_id uuid,
  target_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
  resolved_group_id uuid := target_group_id;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения подходящих деталей.';
  end if;

  if target_reference_item_id is null or not exists (
    select 1 from public.reference_items where id = target_reference_item_id
  ) then
    raise exception 'Вид прибора не найден.';
  end if;

  if target_item_id is null or not exists (
    select 1 from public.inventory_items where id = target_item_id
  ) then
    raise exception 'Позиция номенклатуры не найдена.';
  end if;

  if resolved_group_id is null then
    select g.id
      into resolved_group_id
    from public.device_compatible_part_groups g
    order by g.sort_order, g.created_at
    limit 1;

    if resolved_group_id is null then
      insert into public.device_compatible_part_groups (name, color, sort_order, created_by)
      values ('Основные', '#2563eb', 0, auth.uid())
      returning id into resolved_group_id;
    end if;
  elsif not exists (
    select 1 from public.device_compatible_part_groups where id = resolved_group_id
  ) then
    raise exception 'Группа не найдена.';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into next_order
  from public.device_compatible_parts
  where reference_item_id = target_reference_item_id
    and group_id = resolved_group_id;

  insert into public.device_compatible_parts (
    reference_item_id, item_id, group_id, sort_order, created_by
  )
  values (
    target_reference_item_id, target_item_id, resolved_group_id, next_order, auth.uid()
  )
  on conflict (reference_item_id, item_id) do update
    set sort_order = public.device_compatible_parts.sort_order,
        group_id = public.device_compatible_parts.group_id
  returning id into result_id;

  return result_id;
end;
$$;

revoke all on function public.list_device_compatible_part_groups(uuid) from public, anon;
revoke all on function public.upsert_device_compatible_part_group(uuid, text, text) from public, anon;
revoke all on function public.delete_device_compatible_part_group(uuid) from public, anon;
revoke all on function public.reorder_device_compatible_part_groups(uuid[]) from public, anon;
revoke all on function public.reorder_device_compatible_parts(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.add_device_compatible_part(uuid, uuid, uuid) from public, anon;

grant execute on function public.list_device_compatible_part_groups(uuid) to authenticated;
grant execute on function public.upsert_device_compatible_part_group(uuid, text, text) to authenticated;
grant execute on function public.delete_device_compatible_part_group(uuid) to authenticated;
grant execute on function public.reorder_device_compatible_part_groups(uuid[]) to authenticated;
grant execute on function public.reorder_device_compatible_parts(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.add_device_compatible_part(uuid, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [17/60 | was 108/151] 20260829860000_public_company_logo.sql
-- -----------------------------------------------------------------------------

-- Логотип компании виден без входа: экран входа, favicon, публичные страницы.

create or replace function public.get_company_logo()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  logo_path text;
begin
  select nullif(btrim(coalesce(value ->> 'path', '')), '')
    into logo_path
  from public.app_settings
  where key = 'company_logo';

  return logo_path;
end;
$$;

revoke all on function public.get_company_logo() from public;
grant execute on function public.get_company_logo() to anon, authenticated;

drop policy if exists company_logo_select on storage.objects;
create policy company_logo_select
  on storage.objects
  for select
  to public
  using (bucket_id = 'company-logo');

-- -----------------------------------------------------------------------------
-- [18/60 | was 109/151] 20260829870000_invite_fail_rollback.sql
-- -----------------------------------------------------------------------------

-- Allow rolling back an invitation after Auth user was created but email failed.
create or replace function public.fail_invitation(target_invitation_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('users:invite') then
    raise exception 'Недостаточно прав.';
  end if;

  update public.invitations
  set status = 'failed',
      accepted_at = null,
      auth_user_id = null
  where id = target_invitation_id
    and invited_by = auth.uid()
    and status in ('pending', 'accepted');

  perform public.record_audit(
    'users.invite_failed',
    'invitation',
    target_invitation_id::text,
    jsonb_build_object('reason', reason)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- [19/60 | was 110/151] 20260829880000_inventory_receipt_drafts.sql
-- -----------------------------------------------------------------------------

-- Черновики приходов: сохранение без проведения на склад.

alter table public.inventory_receipts
  add column if not exists status text not null default 'posted',
  add column if not exists draft_lines jsonb not null default '[]'::jsonb;

update public.inventory_receipts
set status = 'posted'
where status is distinct from 'posted' and status is distinct from 'draft';

alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_status_check;

alter table public.inventory_receipts
  add constraint inventory_receipts_status_check
  check (status in ('draft', 'posted'));

alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_supplier_present;

alter table public.inventory_receipts
  add constraint inventory_receipts_supplier_present
  check (status = 'draft' or btrim(supplier) <> '');

alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_draft_lines_check;

alter table public.inventory_receipts
  add constraint inventory_receipts_draft_lines_check
  check (jsonb_typeof(draft_lines) = 'array');

create index if not exists inventory_receipts_status_idx
  on public.inventory_receipts (status, created_at desc)
  where hidden_at is null;

create or replace function public.save_inventory_receipt_draft(
  target_receipt_id uuid default null,
  supplier_name text default '',
  doc_receipt_date date default current_date,
  doc_notes text default '',
  lines jsonb default '[]'::jsonb,
  supplier_customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_id uuid;
  resolved_name text;
  resolved_supplier_id uuid;
  line record;
  normalized_lines jsonb := '[]'::jsonb;
  line_count integer := 0;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для прихода.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректный список позиций.';
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
  elsif resolved_name <> '' then
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

  for line in
    select *
    from jsonb_to_recordset(coalesce(lines, '[]'::jsonb)) as x(
      item_id uuid,
      quantity numeric,
      purchase_price numeric
    )
  loop
    if line.item_id is null then
      raise exception 'В строке прихода не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция прихода не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 or line.quantity <> trunc(line.quantity) then
      raise exception 'Количество в приходе должно быть целым числом больше нуля.';
    end if;

    if line.purchase_price is null or line.purchase_price < 0 then
      raise exception 'Цена закупки не может быть отрицательной.';
    end if;

    normalized_lines := normalized_lines || jsonb_build_array(
      jsonb_build_object(
        'item_id', line.item_id,
        'quantity', line.quantity,
        'purchase_price', line.purchase_price
      )
    );
    line_count := line_count + 1;
  end loop;

  if target_receipt_id is null then
    insert into public.inventory_receipts (
      supplier, supplier_id, receipt_date, notes, created_by, status, draft_lines
    )
    values (
      resolved_name,
      resolved_supplier_id,
      doc_receipt_date,
      btrim(coalesce(doc_notes, '')),
      auth.uid(),
      'draft',
      normalized_lines
    )
    returning id into receipt_id;
  else
    update public.inventory_receipts
    set supplier = resolved_name,
        supplier_id = resolved_supplier_id,
        receipt_date = doc_receipt_date,
        notes = btrim(coalesce(doc_notes, '')),
        draft_lines = normalized_lines
    where id = target_receipt_id
      and status = 'draft'
      and hidden_at is null
    returning id into receipt_id;

    if receipt_id is null then
      raise exception 'Черновик прихода не найден.';
    end if;
  end if;

  perform public.record_audit(
    'inventory.receipt_draft_saved',
    'inventory_receipt',
    receipt_id::text,
    jsonb_build_object('supplier', resolved_name, 'lines', line_count)
  );

  return receipt_id;
end;
$$;

create or replace function public.receive_inventory(
  supplier_name text,
  doc_receipt_date date,
  doc_notes text,
  lines jsonb,
  supplier_customer_id uuid default null,
  draft_receipt_id uuid default null
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
  source_lines jsonb;
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

  source_lines := coalesce(lines, '[]'::jsonb);
  if jsonb_typeof(source_lines) <> 'array' or jsonb_array_length(source_lines) = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  if draft_receipt_id is not null then
    update public.inventory_receipts
    set supplier = resolved_name,
        supplier_id = resolved_supplier_id,
        receipt_date = doc_receipt_date,
        notes = btrim(coalesce(doc_notes, '')),
        draft_lines = '[]'::jsonb,
        status = 'posted'
    where id = draft_receipt_id
      and status = 'draft'
      and hidden_at is null
    returning id into receipt_id;

    if receipt_id is null then
      raise exception 'Черновик прихода не найден.';
    end if;
  else
    insert into public.inventory_receipts (
      supplier, supplier_id, receipt_date, notes, created_by, status, draft_lines
    )
    values (
      resolved_name,
      resolved_supplier_id,
      doc_receipt_date,
      btrim(coalesce(doc_notes, '')),
      auth.uid(),
      'posted',
      '[]'::jsonb
    )
    returning id into receipt_id;
  end if;

  for line in
    select *
    from jsonb_to_recordset(source_lines) as x(
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
  status text,
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
    r.status,
    r.created_at,
    coalesce(p.full_name, '') as actor_name,
    case
      when r.status = 'draft' then coalesce(jsonb_array_length(r.draft_lines), 0)::bigint
      else count(m.id)
    end as line_count,
    case
      when r.status = 'draft' then coalesce((
        select sum((line_row.elem ->> 'quantity')::numeric)
        from jsonb_array_elements(r.draft_lines) as line_row(elem)
      ), 0)
      else coalesce(sum(m.quantity), 0)
    end as total_quantity,
    count(*) over() as total_count
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  left join public.inventory_movements m
    on m.reference_type = 'receipt'
   and m.reference_id = r.id
   and m.movement_type = 'receipt'
   and r.status = 'posted'
  where r.hidden_at is null
  group by r.id, r.supplier, r.supplier_id, r.receipt_date, r.notes, r.status, r.draft_lines, r.created_at, p.full_name
  order by
    case when r.status = 'draft' then 0 else 1 end,
    r.created_at desc
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
  receipt_status text;
  receipt_draft_lines jsonb;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра прихода.';
  end if;

  select
    jsonb_build_object(
      'id', r.id,
      'supplier', r.supplier,
      'supplier_id', r.supplier_id,
      'receipt_date', r.receipt_date,
      'notes', r.notes,
      'status', r.status,
      'created_at', r.created_at,
      'actor_name', coalesce(p.full_name, '')
    ),
    r.status,
    r.draft_lines
  into header, receipt_status, receipt_draft_lines
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  where r.id = target_receipt_id
    and r.hidden_at is null;

  if header is null then
    raise exception 'Приход не найден.';
  end if;

  if receipt_status = 'draft' then
    return header || jsonb_build_object(
      'lines', coalesce((
        select jsonb_agg(row_to_json(x)::jsonb order by x.sort_order)
        from (
          select
            'draft-' || ordinality::text as id,
            (elem ->> 'item_id')::uuid as item_id,
            i.name as item_name,
            i.code as item_code,
            i.article as item_article,
            i.barcode as item_barcode,
            i.category_id,
            coalesce(cat.name, '') as category_name,
            i.unit_id,
            coalesce(u.name, '') as unit_name,
            i.purchase_price as item_purchase_price,
            i.repair_price,
            i.retail_price,
            coalesce((
              select sum(b.remaining_quantity)
              from public.inventory_batches b
              where b.item_id = i.id
            ), 0) as stock_quantity,
            i.created_at as item_created_at,
            i.updated_at as item_updated_at,
            (elem ->> 'quantity')::numeric as quantity,
            (elem ->> 'purchase_price')::numeric as unit_price,
            null::uuid as batch_id,
            0::numeric as remaining_quantity,
            ordinality as sort_order,
            null::timestamptz as created_at
          from jsonb_array_elements(coalesce(receipt_draft_lines, '[]'::jsonb))
            with ordinality as draft(elem, ordinality)
          join public.inventory_items i on i.id = (elem ->> 'item_id')::uuid
          left join public.reference_items cat on cat.id = i.category_id
          left join public.reference_items u on u.id = i.unit_id
        ) x
      ), '[]'::jsonb)
    );
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

  if current_row.status = 'draft' then
    delete from public.inventory_receipts where id = target_receipt_id;

    perform public.record_audit(
      'inventory.receipt_draft_deleted',
      'inventory_receipt',
      target_receipt_id::text,
      jsonb_build_object('supplier', current_row.supplier)
    );
    return;
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

revoke all on function public.save_inventory_receipt_draft(uuid, text, date, text, jsonb, uuid) from public, anon;
grant execute on function public.save_inventory_receipt_draft(uuid, text, date, text, jsonb, uuid) to authenticated;

revoke all on function public.receive_inventory(text, date, text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.receive_inventory(text, date, text, jsonb, uuid, uuid) to authenticated;

-- Оставляем одну сигнатуру с default-аргументами (PostgREST иначе путает overloads).
drop function if exists public.receive_inventory(text, date, text, jsonb);
drop function if exists public.receive_inventory(text, date, text, jsonb, uuid);

revoke all on function public.list_inventory_receipts(integer, integer) from public, anon;
grant execute on function public.list_inventory_receipts(integer, integer) to authenticated;

revoke all on function public.get_inventory_receipt(uuid) from public, anon;
grant execute on function public.get_inventory_receipt(uuid) to authenticated;

revoke all on function public.delete_inventory_receipt(uuid, text) from public, anon;
grant execute on function public.delete_inventory_receipt(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [20/60 | was 111/151] 20260829890000_order_update_journal_changes.sql
-- -----------------------------------------------------------------------------

-- Явное сохранение заказа: одна запись в истории с перечнем изменений полей
-- (включая очистку срока и даты готовности).
-- Отдельные триггеры по клиенту/прибору/ответственному отключаем, чтобы
-- одно «Сохранить» не плодило несколько событий в ленте.

drop trigger if exists orders_responsible_journal on public.orders;
drop trigger if exists orders_customer_journal on public.orders;
drop trigger if exists orders_device_journal on public.orders;

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
  changes jsonb := '[]'::jsonb;
  next_deadline date;
  next_ready_date date;
  next_responsible uuid;
  next_customer uuid;
  next_device uuid;
  old_customer_name text;
  new_customer_name text;
  old_device_label text;
  new_device_label text;
  old_responsible_name text;
  new_responsible_name text;
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
    select trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), d.serial_number))
      into old_device_label
    from public.devices d
    left join public.reference_items brand on brand.id = d.brand_id
    left join public.reference_items model on model.id = d.model_id
    where d.id = current_row.device_id;
    select trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), d.serial_number))
      into new_device_label
    from public.devices d
    left join public.reference_items brand on brand.id = d.brand_id
    left join public.reference_items model on model.id = d.model_id
    where d.id = next_device;
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

revoke all on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean
) from public, anon;
grant execute on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean
) to authenticated;

-- -----------------------------------------------------------------------------
-- [21/60 | was 112/151] 20260829900000_document_template_soft_delete.sql
-- -----------------------------------------------------------------------------

-- Шаблоны документов можно удалять даже если по ним уже есть документы.
-- Удаление мягкое: строка остаётся для истории документов, из списков пропадает.

alter table public.document_templates
  add column if not exists deleted_at timestamptz;

create index if not exists document_templates_active_idx
  on public.document_templates (kind, name)
  where deleted_at is null;

drop index if exists document_templates_code_unique;
create unique index document_templates_code_unique
  on public.document_templates (code)
  where deleted_at is null;

create or replace function public.list_document_templates(
  kind_filter text default '',
  search_query text default ''
)
returns table (
  id uuid,
  code text,
  name text,
  kind text,
  page_size text,
  is_system boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  kind_value text;
begin
  perform public.assert_documents_access();

  kind_value := coalesce(nullif(btrim(kind_filter), ''), '');
  if kind_value <> '' and kind_value not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
    raise exception 'Неизвестный тип шаблона.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select
    t.id,
    t.code,
    t.name,
    t.kind,
    t.page_size,
    t.is_system,
    t.updated_at
  from public.document_templates t
  where t.deleted_at is null
    and (kind_value = '' or t.kind = kind_value)
    and (
      btrim(coalesce(search_query, '')) = ''
      or t.name ilike term escape '\'
      or t.code ilike term escape '\'
    )
  order by t.is_system desc, t.name;
end;
$$;

create or replace function public.get_document_template(target_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  perform public.assert_documents_access();

  select jsonb_build_object(
    'id', t.id,
    'code', t.code,
    'name', t.name,
    'kind', t.kind,
    'page_size', t.page_size,
    'body', t.body,
    'is_system', t.is_system,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
  into payload
  from public.document_templates t
  where t.id = target_template_id
    and t.deleted_at is null;

  if payload is null then
    raise exception 'Шаблон не найден.';
  end if;

  return payload;
end;
$$;

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
    and deleted_at is null
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
  where id = target_template_id
    and deleted_at is null;

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
    and deleted_at is null
  for update;

  if current_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  update public.document_templates
  set deleted_at = now()
  where id = target_template_id
    and deleted_at is null;

  perform public.record_audit(
    'document.template_deleted',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', current_row.name)
  );
end;
$$;

create or replace function public.create_document(
  target_template_id uuid,
  p_source_type text default 'none',
  p_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  template_row public.document_templates%rowtype;
  result_id uuid;
  next_number text;
  source_type text;
  context jsonb;
begin
  perform public.assert_documents_create();

  select * into template_row
  from public.document_templates
  where id = target_template_id
    and deleted_at is null;

  if template_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  source_type := coalesce(nullif(btrim(p_source_type), ''), 'none');
  if source_type not in ('order', 'sale', 'item', 'none') then
    raise exception 'Неизвестный источник.';
  end if;

  if source_type = 'none' then
    p_source_id := null;
  elsif p_source_id is null then
    raise exception 'Укажите объект документа.';
  end if;

  next_number := 'ДОК-' || lpad(nextval('public.document_number_seq')::text, 6, '0');
  context := public.build_document_context(source_type, p_source_id, next_number, '');

  insert into public.documents (
    number, template_id, title, kind, source_type, source_id, status, body, context, created_by
  )
  values (
    next_number,
    template_row.id,
    template_row.name,
    template_row.kind,
    source_type,
    p_source_id,
    'draft',
    template_row.body,
    context,
    auth.uid()
  )
  returning id into result_id;

  perform public.record_audit(
    'document.created',
    'document',
    result_id::text,
    jsonb_build_object('number', next_number, 'template_id', template_row.id, 'source_type', source_type)
  );

  return result_id;
end;
$$;

revoke all on function public.list_document_templates(text, text) from public, anon;
grant execute on function public.list_document_templates(text, text) to authenticated;

revoke all on function public.get_document_template(uuid) from public, anon;
grant execute on function public.get_document_template(uuid) to authenticated;

revoke all on function public.update_document_template(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.update_document_template(uuid, text, text, text, jsonb) to authenticated;

revoke all on function public.delete_document_template(uuid) from public, anon;
grant execute on function public.delete_document_template(uuid) to authenticated;

revoke all on function public.create_document(uuid, text, uuid) from public, anon;
grant execute on function public.create_document(uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [22/60 | was 113/151] 20260829910000_tasks_manage_others.sql
-- -----------------------------------------------------------------------------

-- Чужие и общие (без исполнителя) задачи — отдельное право роли.
-- Без него видны и правятся только задачи, назначенные текущему пользователю.
-- В списках свои открытые задачи идут первыми.

insert into public.permissions (code, name)
values ('tasks:manage_others', 'Задачи: чужие и общие')
on conflict (code) do update set name = excluded.name;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where p.code = 'tasks:manage_others'
  and r.code in ('director', 'manager', 'chief_engineer')
on conflict do nothing;

create or replace function public.has_tasks_manage_others()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('tasks:manage_others');
$$;

create or replace function public.can_view_task(assignee_id uuid, created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_tasks_manage_others()
    or assignee_id = auth.uid()
    or created_by = auth.uid();
$$;

create or replace function public.can_mutate_task(assignee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_tasks_manage_others()
    or assignee_id = auth.uid();
$$;

create or replace function public.list_tasks(
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
  manage_others boolean := public.has_tasks_manage_others();
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

  if not manage_others and assignee_value = 'unassigned' then
    raise exception 'Недостаточно прав для просмотра общих задач.';
  end if;

  if assignee_value not in ('all', 'unassigned') then
    begin
      assignee_uuid := assignee_value::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Некорректный исполнитель.';
    end;
    if not manage_others and assignee_uuid is distinct from auth.uid() then
      raise exception 'Недостаточно прав для просмотра чужих задач.';
    end if;
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
  where public.can_view_task(t.assignee_id, t.created_by)
    and (status_value = 'all' or (status_value = 'open' and not t.completed) or (status_value = 'completed' and t.completed))
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
  order by
    t.completed asc,
    case
      when not t.completed and t.assignee_id = auth.uid() then 0
      else 1
    end,
    t.due_date asc nulls last,
    t.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_task(target_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
  row_assignee uuid;
  row_created_by uuid;
begin
  perform public.assert_tasks_read();

  select t.assignee_id, t.created_by
    into row_assignee, row_created_by
  from public.tasks t
  where t.id = target_task_id;

  if not found then
    raise exception 'Задача не найдена.';
  end if;

  if not public.can_view_task(row_assignee, row_created_by) then
    raise exception 'Недостаточно прав для просмотра задачи.';
  end if;

  payload := public.task_json(target_task_id);
  if payload is null then
    raise exception 'Задача не найдена.';
  end if;
  return payload;
end;
$$;

create or replace function public.count_open_tasks()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result bigint;
begin
  perform public.assert_tasks_read();
  select count(*) into result
  from public.tasks t
  where t.completed = false
    and public.can_view_task(t.assignee_id, t.created_by);
  return coalesce(result, 0);
end;
$$;

create or replace function public.create_task(
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

  if (p_assignee_id is null or p_assignee_id is distinct from auth.uid())
     and not public.has_tasks_manage_others() then
    raise exception 'Недостаточно прав для назначения чужих или общих задач.';
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

  if not public.can_mutate_task(current_row.assignee_id) then
    raise exception 'Недостаточно прав для изменения чужой или общей задачи.';
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

  if (p_assignee_id is null or p_assignee_id is distinct from auth.uid())
     and not public.has_tasks_manage_others() then
    raise exception 'Недостаточно прав для назначения чужих или общих задач.';
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

create or replace function public.set_task_completed(
  target_task_id uuid,
  p_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.tasks%rowtype;
  next_completed boolean := coalesce(p_completed, false);
begin
  perform public.assert_tasks_update();

  select * into current_row
  from public.tasks
  where id = target_task_id
  for update;

  if current_row.id is null then
    raise exception 'Задача не найдена.';
  end if;

  if not public.can_mutate_task(current_row.assignee_id) then
    raise exception 'Недостаточно прав для изменения чужой или общей задачи.';
  end if;

  if current_row.completed is not distinct from next_completed then
    return;
  end if;

  if next_completed then
    update public.tasks
    set completed = true,
        completed_at = now()
    where id = target_task_id;

    if current_row.order_id is not null then
      perform public.write_task_order_journal(
        current_row.order_id,
        'task_completed',
        'Задача «' || left(current_row.title, 120) || '» выполнена',
        jsonb_build_object('task_id', current_row.id, 'title', current_row.title)
      );
    end if;
  else
    update public.tasks
    set completed = false,
        completed_at = null
    where id = target_task_id;
  end if;

  perform public.record_audit(
    case when next_completed then 'task.completed' else 'task.reopened' end,
    'task',
    target_task_id::text,
    jsonb_build_object('order_id', current_row.order_id)
  );
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

  if not public.can_mutate_task(current_row.assignee_id) then
    raise exception 'Недостаточно прав для удаления чужой или общей задачи.';
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

revoke all on function public.has_tasks_manage_others() from public, anon;
revoke all on function public.can_view_task(uuid, uuid) from public, anon;
revoke all on function public.can_mutate_task(uuid) from public, anon;
revoke all on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) from public, anon;
revoke all on function public.get_task(uuid) from public, anon;
revoke all on function public.count_open_tasks() from public, anon;
revoke all on function public.create_task(text, text, uuid, timestamptz, text, uuid) from public, anon;
revoke all on function public.update_task(uuid, text, text, uuid, timestamptz, text) from public, anon;
revoke all on function public.set_task_completed(uuid, boolean) from public, anon;
revoke all on function public.delete_task(uuid) from public, anon;

grant execute on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) to authenticated;
grant execute on function public.get_task(uuid) to authenticated;
grant execute on function public.count_open_tasks() to authenticated;
grant execute on function public.create_task(text, text, uuid, timestamptz, text, uuid) to authenticated;
grant execute on function public.update_task(uuid, text, text, uuid, timestamptz, text) to authenticated;
grant execute on function public.set_task_completed(uuid, boolean) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [23/60 | was 114/151] 20260829920000_inventory_item_is_permanent.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- [24/60 | was 115/151] 20260829930000_restore_label_part_template.sql
-- -----------------------------------------------------------------------------

-- Восстановить системную этикетку запчасти: без неё печать наклеек из карточки склада недоступна.

update public.document_templates
set
  deleted_at = null,
  name = 'Этикетка запчасти',
  kind = 'label',
  page_size = 'label',
  is_system = true,
  body = $json$
  [
    {"id":"p1","type":"text","text":"{{item.name}}"},
    {"id":"p2","type":"text","text":"{{item.code}}"},
    {"id":"bc1","type":"barcode","value":"{{item.barcode}}"},
    {"id":"p3","type":"text","text":"{{item.article}}"}
  ]
  $json$::jsonb
where id = (
  select t.id
  from public.document_templates t
  where t.code = 'label_part'
    and t.deleted_at is not null
    and not exists (
      select 1
      from public.document_templates active
      where active.code = 'label_part'
        and active.deleted_at is null
    )
  order by t.updated_at desc nulls last, t.created_at desc
  limit 1
);

insert into public.document_templates (code, name, kind, page_size, is_system, body)
select
  'label_part',
  'Этикетка запчасти',
  'label',
  'label',
  true,
  $json$
  [
    {"id":"p1","type":"text","text":"{{item.name}}"},
    {"id":"p2","type":"text","text":"{{item.code}}"},
    {"id":"bc1","type":"barcode","value":"{{item.barcode}}"},
    {"id":"p3","type":"text","text":"{{item.article}}"}
  ]
  $json$::jsonb
where not exists (
  select 1
  from public.document_templates t
  where t.code = 'label_part'
    and t.deleted_at is null
);

-- -----------------------------------------------------------------------------
-- [25/60 | was 116/151] 20260829940000_order_total_document_field.sql
-- -----------------------------------------------------------------------------

-- Поле шаблона «Сумма заказа»: работы + запчасти (как Итог в списке заказов).

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
    'order.total', '',
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
        'order.total', trim(to_char(public.order_total_amount(o.id), '999999990.99')),
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


-- -----------------------------------------------------------------------------
-- [26/60 | was 117/151] 20260829950000_order_work_fields_journal.sql
-- -----------------------------------------------------------------------------

-- Сохранение полей order_work / доп. полей orders → запись в историю заказа.

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
  journal_enabled boolean := false;
  old_fields jsonb := '{}'::jsonb;
  changes jsonb := '[]'::jsonb;
  old_value jsonb;
  new_value jsonb;
  summary_text text;
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
  elsif target_entity_code = 'inventory' then
    permission_code := 'inventory:receive';
  elsif target_entity_code = 'order_work' then
    permission_code := 'orders:update';
  elsif target_entity_code = 'devices' then
    if not (
      public.has_permission('devices:update')
      or public.has_permission('settings:update')
    ) then
      raise exception 'Недостаточно прав для сохранения полей.';
    end if;
    permission_code := null;
  end if;

  if permission_code is not null and not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
  end if;

  journal_enabled :=
    target_entity_code in ('order_work', 'orders')
    and exists (select 1 from public.orders where id = target_record_id);

  if journal_enabled then
    select coalesce(jsonb_object_agg(f.code, v.value), '{}'::jsonb)
      into old_fields
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id and v.record_id = target_record_id
    where f.entity_code = target_entity_code
      and f.is_active = true
      and not public.is_order_card_field(f.entity_code, f.code);
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
      new_value := null;
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
      new_value := raw;
    end if;

    if journal_enabled then
      old_value := old_fields -> field_row.code;
      if old_value = 'null'::jsonb then
        old_value := null;
      end if;
      if old_value is not null
        and jsonb_typeof(old_value) = 'string'
        and btrim(old_value #>> '{}') = ''
      then
        old_value := null;
      end if;

      if old_value is distinct from new_value then
        changes := changes || jsonb_build_array(jsonb_build_object(
          'field', field_row.code,
          'label', field_row.name,
          'from', old_value,
          'to', new_value
        ));
      end if;
    end if;
  end loop;

  if journal_enabled and jsonb_array_length(changes) > 0 then
    summary_text := case
      when target_entity_code = 'order_work' then 'Изменены поля состава работы'
      else 'Изменения в заказе'
    end;

    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      target_record_id,
      'order_updated',
      auth.uid(),
      summary_text,
      jsonb_build_object('changes', changes)
    );

    perform public.record_audit(
      'orders.updated',
      'order',
      target_record_id::text,
      jsonb_build_object(
        'entity_code', target_entity_code,
        'changes', changes
      )
    );
  end if;
end;
$$;

revoke all on function public.save_dynamic_field_values(text, uuid, jsonb) from public, anon;
grant execute on function public.save_dynamic_field_values(text, uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- [27/60 | was 118/151] 20260829960000_label_part_barcode_field.sql
-- -----------------------------------------------------------------------------

-- Этикетка запчасти: в штрихкод только item.barcode.
-- Код и артикул остаются текстовыми полями, без подмены в barcode.

update public.document_templates t
set
  body = (
    select coalesce(
      jsonb_agg(
        case
          when block->>'type' = 'barcode'
            and btrim(coalesce(block->>'value', '')) in ('{{item.code}}', '{{ item.code }}')
          then jsonb_set(block, '{value}', '"{{item.barcode}}"')
          when block->>'type' = 'html' and coalesce(block->>'html', '') <> '' then
            jsonb_set(
              block,
              '{html}',
              to_jsonb(
                replace(
                  replace(block->>'html', 'data-code="{{item.code}}"', 'data-code="{{item.barcode}}"'),
                  'data-code=''{{item.code}}''',
                  'data-code=''{{item.barcode}}'''
                )
              )
            )
          else block
        end
        order by ordinality
      ),
      t.body
    )
    from jsonb_array_elements(t.body) with ordinality as x(block, ordinality)
  ),
  updated_at = now()
where t.code = 'label_part'
  and t.is_system = true
  and t.deleted_at is null
  and jsonb_typeof(t.body) = 'array';

insert into public.document_templates (code, name, kind, page_size, is_system, body)
select
  'label_part',
  'Этикетка запчасти',
  'label',
  'label',
  true,
  $json$
  [
    {"id":"p1","type":"text","text":"{{item.name}}"},
    {"id":"p2","type":"text","text":"{{item.code}}"},
    {"id":"bc1","type":"barcode","value":"{{item.barcode}}"},
    {"id":"p3","type":"text","text":"{{item.article}}"}
  ]
  $json$::jsonb
where not exists (
  select 1
  from public.document_templates t
  where t.code = 'label_part'
    and t.deleted_at is null
);

-- -----------------------------------------------------------------------------
-- [28/60 | was 119/151] 20260829970000_order_work_values_read.sql
-- -----------------------------------------------------------------------------

-- Значения полей «Состав работы» (order_work) должны читаться с orders:read.
-- Иначе админ (settings:read) видит текст, а остальные — пустые поля при живой истории
-- (журнал идёт через security definer и RLS не режет).

create or replace function public.dynamic_field_entity_read_permission(p_entity text)
returns text
language sql
immutable
as $$
  select case p_entity
    when 'order_work' then 'orders:read'
    when 'diagnostics' then 'diagnostics:read'
    when 'inventory' then 'inventory:read'
    else p_entity || ':read'
  end;
$$;

drop policy if exists dynamic_field_values_select_entity_read on public.dynamic_field_values;
create policy dynamic_field_values_select_entity_read
  on public.dynamic_field_values
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('settings:read')
      or public.has_permission(public.dynamic_field_entity_read_permission(entity_code))
    )
  );

-- Надёжное чтение значений (обход RLS с проверкой прав) — единый путь для карточек.
create or replace function public.list_dynamic_field_values(
  target_entity_code text,
  target_record_id uuid
)
returns table (
  field_id uuid,
  value jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.field_entities where code = target_entity_code) then
    raise exception 'Раздел карточки не найден.';
  end if;

  if not (
    public.has_permission('settings:read')
    or public.has_permission(public.dynamic_field_entity_read_permission(target_entity_code))
  ) then
    raise exception 'Недостаточно прав для чтения полей.';
  end if;

  return query
  select v.field_id, v.value
  from public.dynamic_field_values v
  where v.entity_code = target_entity_code
    and v.record_id = target_record_id;
end;
$$;

revoke all on function public.dynamic_field_entity_read_permission(text) from public, anon;
revoke all on function public.list_dynamic_field_values(text, uuid) from public, anon;
grant execute on function public.dynamic_field_entity_read_permission(text) to authenticated;
grant execute on function public.list_dynamic_field_values(text, uuid) to authenticated;

-- Не писать в журнал «изменения» без фактической смены значения (from === to).
create or replace function public.normalize_dynamic_field_journal_value(raw jsonb)
returns text
language sql
immutable
as $$
  select case
    when raw is null or raw = 'null'::jsonb then null
    when jsonb_typeof(raw) = 'string' then nullif(btrim(raw #>> '{}'), '')
    when jsonb_typeof(raw) in ('number', 'boolean') then raw #>> '{}'
    else raw::text
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
  journal_enabled boolean := false;
  old_fields jsonb := '{}'::jsonb;
  changes jsonb := '[]'::jsonb;
  old_value jsonb;
  new_value jsonb;
  old_norm text;
  new_norm text;
  summary_text text;
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
  elsif target_entity_code = 'inventory' then
    permission_code := 'inventory:receive';
  elsif target_entity_code = 'order_work' then
    permission_code := 'orders:update';
  elsif target_entity_code = 'devices' then
    if not (
      public.has_permission('devices:update')
      or public.has_permission('settings:update')
    ) then
      raise exception 'Недостаточно прав для сохранения полей.';
    end if;
    permission_code := null;
  end if;

  if permission_code is not null and not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
  end if;

  journal_enabled :=
    target_entity_code in ('order_work', 'orders')
    and exists (select 1 from public.orders where id = target_record_id);

  if journal_enabled then
    select coalesce(jsonb_object_agg(f.code, v.value), '{}'::jsonb)
      into old_fields
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id and v.record_id = target_record_id
    where f.entity_code = target_entity_code
      and f.is_active = true
      and not public.is_order_card_field(f.entity_code, f.code);
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
      new_value := null;
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
      new_value := raw;
    end if;

    if journal_enabled then
      old_value := old_fields -> field_row.code;
      old_norm := public.normalize_dynamic_field_journal_value(old_value);
      new_norm := public.normalize_dynamic_field_journal_value(new_value);

      if old_norm is distinct from new_norm then
        changes := changes || jsonb_build_array(jsonb_build_object(
          'field', field_row.code,
          'label', field_row.name,
          'from', to_jsonb(old_norm),
          'to', to_jsonb(new_norm)
        ));
      end if;
    end if;
  end loop;

  if journal_enabled and jsonb_array_length(changes) > 0 then
    summary_text := case
      when target_entity_code = 'order_work' then 'Изменены поля состава работы'
      else 'Изменения в заказе'
    end;

    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      target_record_id,
      'order_updated',
      auth.uid(),
      summary_text,
      jsonb_build_object('changes', changes)
    );

    perform public.record_audit(
      'orders.updated',
      'order',
      target_record_id::text,
      jsonb_build_object(
        'entity_code', target_entity_code,
        'changes', changes
      )
    );
  end if;
end;
$$;

revoke all on function public.normalize_dynamic_field_journal_value(jsonb) from public, anon;
revoke all on function public.save_dynamic_field_values(text, uuid, jsonb) from public, anon;
grant execute on function public.normalize_dynamic_field_journal_value(jsonb) to authenticated;
grant execute on function public.save_dynamic_field_values(text, uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- [29/60 | was 120/151] 20260829975000_search_inventory_items_category_filter.sql
-- -----------------------------------------------------------------------------

-- Фильтр склада по категории (группе деталей).

drop function if exists public.search_inventory_items(text, integer, integer, text);
drop function if exists public.search_inventory_items(text, integer, integer, text, uuid);

create function public.search_inventory_items(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  stock_filter text default 'all',
  category_filter uuid default null
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
    and (category_filter is null or i.category_id = category_filter)
    and (stock_value <> 'zero' or (coalesce(stock.qty, 0) <= 0 and i.is_permanent))
    and (stock_value <> 'in_stock' or coalesce(stock.qty, 0) > 0)
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.search_inventory_items(text, integer, integer, text, uuid) from public, anon;
grant execute on function public.search_inventory_items(text, integer, integer, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [30/60 | was 121/151] 20260829980000_inventory_min_stock_category_filter.sql
-- -----------------------------------------------------------------------------

-- Минимальный остаток номенклатуры + фильтр поиска по категории / ниже минимума.

alter table public.inventory_items
  add column if not exists min_stock numeric(14, 0) not null default 0
    check (min_stock >= 0);

comment on column public.inventory_items.min_stock is
  'Минимальный остаток: при остатке ≤ минимума (и min_stock > 0) позиция в фильтре «Ниже минимума».';


drop function if exists public.create_inventory_item(text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean);

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
  item_is_permanent boolean default true,
  item_min_stock numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_code text;
  min_qty numeric := greatest(0, round(coalesce(item_min_stock, 0)));
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

  if coalesce(item_min_stock, 0) < 0
     or coalesce(item_min_stock, 0) <> round(coalesce(item_min_stock, 0)) then
    raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    next_code := 'N-' || lpad(nextval('public.inventory_item_code_seq')::text, 6, '0');
  end if;

  insert into public.inventory_items (
    code, article, barcode, name, description, category_id, unit_id,
    purchase_price, repair_price, retail_price, is_permanent, min_stock
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
    coalesce(item_is_permanent, true),
    min_qty
  )
  returning id into result_id;

  perform public.record_audit(
    'inventory.item_created',
    'inventory_item',
    result_id::text,
    jsonb_build_object(
      'name', btrim(item_name),
      'code', next_code,
      'is_permanent', coalesce(item_is_permanent, true),
      'min_stock', min_qty
    )
  );

  return result_id;
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
    return null;
end;
$$;


drop function if exists public.update_inventory_item(uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean);

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
  item_is_permanent boolean default true,
  item_min_stock numeric default 0
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
  min_qty numeric := greatest(0, round(coalesce(item_min_stock, 0)));
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

  if coalesce(item_min_stock, 0) < 0
     or coalesce(item_min_stock, 0) <> round(coalesce(item_min_stock, 0)) then
    raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
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
    is_permanent = permanent,
    min_stock = min_qty
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
    jsonb_build_object(
      'name', clean_name,
      'code', next_code,
      'is_permanent', permanent,
      'min_stock', min_qty
    )
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
    'min_stock', i.min_stock,
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
drop function if exists public.search_inventory_items(text, integer, integer, text, uuid);

create function public.search_inventory_items(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  stock_filter text default 'all',
  category_filter uuid default null
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
  min_stock numeric,
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
  if stock_value not in ('all', 'zero', 'in_stock', 'below_min') then
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
    i.min_stock,
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
    and (category_filter is null or i.category_id = category_filter)
    and (stock_value <> 'zero' or (coalesce(stock.qty, 0) <= 0 and i.is_permanent))
    and (stock_value <> 'in_stock' or coalesce(stock.qty, 0) > 0)
    and (
      stock_value <> 'below_min'
      or (i.min_stock > 0 and coalesce(stock.qty, 0) <= i.min_stock)
    )
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
) from public, anon;
revoke all on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
) from public, anon;
revoke all on function public.search_inventory_items(text, integer, integer, text, uuid) from public, anon;

grant execute on function public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
) to authenticated;
grant execute on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
) to authenticated;
grant execute on function public.search_inventory_items(text, integer, integer, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [31/60 | was 122/151] 20260829980000_order_service_line_local_save.sql
-- -----------------------------------------------------------------------------

-- Сохранение правок услуги только в строке заказа (без изменения справочника).
-- Отвязывает строку от шаблона, чтобы последующие правки каталога её не перезаписывали.

create or replace function public.update_order_service_line_for_order(
  target_line_id uuid,
  line_name text,
  line_description text default '',
  line_unit_price numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_service_lines%rowtype;
  clean_name text := btrim(coalesce(line_name, ''));
  clean_description text := btrim(coalesce(line_description, ''));
  clean_price numeric := coalesce(line_unit_price, 0);
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  select * into current_row
  from public.order_service_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Строка услуги в заказе не найдена.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if clean_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.order_service_lines
  set
    template_id = null,
    name = clean_name,
    description = clean_description,
    unit_price = clean_price
  where id = target_line_id;

  perform public.record_audit(
    'orders.service_line_updated_local',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'previous_template_id', current_row.template_id,
      'name', clean_name,
      'unit_price', clean_price
    )
  );
end;
$$;

revoke all on function public.update_order_service_line_for_order(uuid, text, text, numeric) from public, anon;
grant execute on function public.update_order_service_line_for_order(uuid, text, text, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- [32/60 | was 123/151] 20260829990000_list_inventory_receipts_filters.sql
-- -----------------------------------------------------------------------------

-- Фильтры списка приходов: статус и период создания.

drop function if exists public.list_inventory_receipts(integer, integer);
drop function if exists public.list_inventory_receipts(integer, integer, text, timestamptz, timestamptz);

create or replace function public.list_inventory_receipts(
  page_number integer default 1,
  page_size integer default 20,
  status_filter text default 'all',
  created_from timestamptz default null,
  created_to timestamptz default null
)
returns table (
  id uuid,
  supplier text,
  supplier_id uuid,
  receipt_date date,
  notes text,
  status text,
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
  status_value text;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра приходов.';
  end if;

  status_value := coalesce(nullif(btrim(status_filter), ''), 'all');
  if status_value not in ('all', 'draft', 'posted') then
    raise exception 'Неизвестный фильтр статуса.';
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
    r.status,
    r.created_at,
    coalesce(p.full_name, '') as actor_name,
    case
      when r.status = 'draft' then coalesce(jsonb_array_length(r.draft_lines), 0)::bigint
      else count(m.id)
    end as line_count,
    case
      when r.status = 'draft' then coalesce((
        select sum((line_row.elem ->> 'quantity')::numeric)
        from jsonb_array_elements(r.draft_lines) as line_row(elem)
      ), 0)
      else coalesce(sum(m.quantity), 0)
    end as total_quantity,
    count(*) over() as total_count
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  left join public.inventory_movements m
    on m.reference_type = 'receipt'
   and m.reference_id = r.id
   and m.movement_type = 'receipt'
   and r.status = 'posted'
  where r.hidden_at is null
    and (status_value = 'all' or r.status = status_value)
    and (created_from is null or r.created_at >= created_from)
    and (created_to is null or r.created_at < created_to)
  group by r.id, r.supplier, r.supplier_id, r.receipt_date, r.notes, r.status, r.draft_lines, r.created_at, p.full_name
  order by
    case when r.status = 'draft' then 0 else 1 end,
    r.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.list_inventory_receipts(integer, integer, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.list_inventory_receipts(integer, integer, text, timestamptz, timestamptz)
  to authenticated;

-- -----------------------------------------------------------------------------
-- [33/60 | was 124/151] 20260829992000_export_inventory_receipt_lines.sql
-- -----------------------------------------------------------------------------

-- Плоский экспорт строк приходов (формат «Оприходованные товары»).

create or replace function public.export_inventory_receipt_lines(
  status_filter text default 'all',
  created_from timestamptz default null,
  created_to timestamptz default null
)
returns table (
  receipt_number text,
  created_at timestamptz,
  created_by_name text,
  updated_at timestamptz,
  updated_by_name text,
  supplier text,
  invoice_number text,
  warehouse_name text,
  category_name text,
  item_code text,
  item_article text,
  item_barcode text,
  item_name text,
  supplier_warranty numeric,
  warranty_period text,
  expires_at text,
  serial_number text,
  quantity numeric,
  unit_code text,
  unit_price numeric,
  line_amount numeric,
  tax_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  status_value text;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для экспорта приходов.';
  end if;

  status_value := coalesce(nullif(btrim(status_filter), ''), 'all');
  if status_value not in ('all', 'draft', 'posted') then
    raise exception 'Неизвестный фильтр статуса.';
  end if;

  return query
  with receipts as (
    select
      r.id,
      r.supplier,
      r.status,
      r.created_at,
      r.draft_lines,
      coalesce(p.full_name, '') as actor_name,
      coalesce(
        nullif(substring(isk.source_key from '^ro-rcp-(.+)$'), ''),
        'П-' || upper(substr(replace(r.id::text, '-', ''), 1, 6))
      ) as doc_number
    from public.inventory_receipts r
    left join public.profiles p on p.id = r.created_by
    left join lateral (
      select k.source_key
      from public.import_source_keys k
      where k.dataset = 'receipts'
        and k.entity_id = r.id::text
      order by k.updated_at desc nulls last, k.source_key
      limit 1
    ) isk on true
    where r.hidden_at is null
      and (status_value = 'all' or r.status = status_value)
      and (created_from is null or r.created_at >= created_from)
      and (created_to is null or r.created_at < created_to)
  ),
  posted_lines as (
    select
      rc.doc_number,
      rc.created_at,
      rc.actor_name,
      rc.supplier,
      ''::text as invoice_number,
      coalesce(cat.name, '') as category_name,
      coalesce(i.code, '') as item_code,
      coalesce(i.article, '') as item_article,
      coalesce(i.barcode, '') as item_barcode,
      coalesce(i.name, '') as item_name,
      m.quantity,
      coalesce(nullif(btrim(u.code), ''), 'pcs') as unit_code,
      m.unit_price,
      m.created_at as line_created_at,
      m.id as line_id
    from receipts rc
    join public.inventory_movements m
      on m.reference_type = 'receipt'
     and m.reference_id = rc.id
     and m.movement_type = 'receipt'
    join public.inventory_items i on i.id = m.item_id
    left join public.reference_items cat on cat.id = i.category_id
    left join public.reference_items u on u.id = i.unit_id
    where rc.status = 'posted'
  ),
  draft_lines as (
    select
      rc.doc_number,
      rc.created_at,
      rc.actor_name,
      rc.supplier,
      ''::text as invoice_number,
      coalesce(cat.name, '') as category_name,
      coalesce(i.code, '') as item_code,
      coalesce(i.article, '') as item_article,
      coalesce(i.barcode, '') as item_barcode,
      coalesce(i.name, '') as item_name,
      coalesce((elem ->> 'quantity')::numeric, 0) as quantity,
      coalesce(nullif(btrim(u.code), ''), 'pcs') as unit_code,
      coalesce((elem ->> 'purchase_price')::numeric, 0) as unit_price,
      rc.created_at as line_created_at,
      ('draft-' || rc.id::text || '-' || ordinality::text) as line_id
    from receipts rc
    cross join lateral jsonb_array_elements(coalesce(rc.draft_lines, '[]'::jsonb))
      with ordinality as draft(elem, ordinality)
    join public.inventory_items i on i.id = (elem ->> 'item_id')::uuid
    left join public.reference_items cat on cat.id = i.category_id
    left join public.reference_items u on u.id = i.unit_id
    where rc.status = 'draft'
  ),
  lines as (
    select * from posted_lines
    union all
    select * from draft_lines
  )
  select
    l.doc_number,
    l.created_at,
    l.actor_name,
    null::timestamptz,
    ''::text,
    l.supplier,
    l.invoice_number,
    'Склад товаров'::text,
    l.category_name,
    l.item_code,
    l.item_article,
    l.item_barcode,
    l.item_name,
    0::numeric,
    'дн'::text,
    ''::text,
    ''::text,
    l.quantity,
    l.unit_code,
    l.unit_price,
    round(l.quantity * l.unit_price, 2),
    0::numeric
  from lines l
  order by l.created_at desc, l.doc_number desc, l.line_created_at, l.line_id
  limit 50000;
end;
$$;

revoke all on function public.export_inventory_receipt_lines(text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.export_inventory_receipt_lines(text, timestamptz, timestamptz)
  to authenticated;

-- -----------------------------------------------------------------------------
-- [34/60 | was 125/151] 20260829993000_export_inventory_stock_items.sql
-- -----------------------------------------------------------------------------

-- Плоский экспорт остатков склада (формат «Остатки на складе»).

create or replace function public.export_inventory_stock_items(
  search_query text default '',
  stock_filter text default 'all',
  category_filter uuid default null
)
returns table (
  item_code text,
  item_article text,
  manufacturer_code text,
  item_barcode text,
  item_name text,
  category_name text,
  description text,
  stock_quantity numeric,
  ordered_quantity numeric,
  unit_code text,
  expires_at text,
  serial_numbers text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  stock_value text;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('orders:read')
    or public.has_permission('sales:read')
    or public.has_permission('sales:create')
  ) then
    raise exception 'Недостаточно прав для экспорта склада.';
  end if;

  stock_value := coalesce(nullif(btrim(stock_filter), ''), 'all');
  if stock_value not in ('all', 'zero', 'in_stock') then
    raise exception 'Неизвестный фильтр остатка.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with stock as (
    select b.item_id, coalesce(sum(b.remaining_quantity), 0) as qty
    from public.inventory_batches b
    group by b.item_id
  )
  select
    coalesce(i.code, '') as item_code,
    coalesce(i.article, '') as item_article,
    ''::text as manufacturer_code,
    coalesce(i.barcode, '') as item_barcode,
    coalesce(i.name, '') as item_name,
    coalesce(cat.name, '') as category_name,
    coalesce(i.description, '') as description,
    coalesce(stock.qty, 0) as stock_quantity,
    0::numeric as ordered_quantity,
    coalesce(nullif(btrim(u.code), ''), 'pcs') as unit_code,
    ''::text as expires_at,
    ''::text as serial_numbers,
    coalesce(i.purchase_price, 0) as purchase_price,
    coalesce(i.repair_price, 0) as repair_price,
    coalesce(i.retail_price, 0) as retail_price
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
    and (category_filter is null or i.category_id = category_filter)
    and (stock_value <> 'zero' or (coalesce(stock.qty, 0) <= 0 and i.is_permanent))
    and (stock_value <> 'in_stock' or coalesce(stock.qty, 0) > 0)
  order by i.name
  limit 50000;
end;
$$;

revoke all on function public.export_inventory_stock_items(text, text, uuid) from public, anon;
grant execute on function public.export_inventory_stock_items(text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [35/60 | was 126/151] 20260829994000_document_context_custom_parts.sql
-- -----------------------------------------------------------------------------

-- Контекст документа: произвольные запчасти заказа (без item_id) тоже попадают в parts.

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
        'order.total', trim(to_char(public.order_total_amount(o.id), '999999990.99')),
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
        coalesce(nullif(btrim(l.name), ''), i.name, '') as item_name,
        coalesce(i.code, '') as item_code,
        coalesce(i.article, '') as item_article,
        trim(to_char(l.quantity, '999999990.999')) as quantity,
        coalesce(u.name, 'шт') as unit_name,
        trim(to_char(l.unit_price, '999999990.99')) as unit_price,
        l.created_at
      from public.order_part_lines l
      left join public.inventory_items i on i.id = l.item_id
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

-- -----------------------------------------------------------------------------
-- [36/60 | was 127/151] 20260829995000_log_order_total_change.sql
-- -----------------------------------------------------------------------------

-- Журнал: изменение суммы заказа (состав работ / запчасти).

create or replace function public.log_order_total_change(
  target_order_id uuid,
  old_total numeric,
  new_total numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_amount numeric := round(coalesce(old_total, 0)::numeric, 2);
  next_amount numeric := round(coalesce(new_total, 0)::numeric, 2);
begin
  if not (
    public.has_permission('orders:update')
    or public.has_permission('orders:create')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для записи в журнал.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if prev_amount = next_amount then
    return;
  end if;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'total_changed',
    auth.uid(),
    'Сумма заказа',
    jsonb_build_object(
      'old_total', prev_amount,
      'new_total', next_amount,
      'changes', jsonb_build_array(
        jsonb_build_object(
          'field', 'total',
          'label', 'Сумма заказа',
          'from', prev_amount,
          'to', next_amount
        )
      )
    )
  );
end;
$$;

revoke all on function public.log_order_total_change(uuid, numeric, numeric) from public, anon;
grant execute on function public.log_order_total_change(uuid, numeric, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- [37/60 | was 128/151] 20260829996000_permission_matrix_crud.sql
-- -----------------------------------------------------------------------------

-- Полная CRUD-матрица ролей: отдельные права на изменение/удаление склада и удаление пользователей.

insert into public.permissions (code, name)
values
  ('inventory:update', 'Склад: изменение'),
  ('inventory:delete', 'Склад: удаление'),
  ('users:delete', 'Пользователи: удаление')
on conflict (code) do nothing;

-- Руководитель получает все новые права.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'director'
  and p.code in ('inventory:update', 'inventory:delete', 'users:delete')
on conflict do nothing;

-- Кто мог вести приход — сохраняет изменение и удаление номенклатуры.
insert into public.role_permissions (role_id, permission_id)
select distinct rp.role_id, p.id
from public.role_permissions rp
join public.permissions existing on existing.id = rp.permission_id
join public.permissions p on p.code in ('inventory:update', 'inventory:delete')
where existing.code = 'inventory:receive'
on conflict do nothing;

-- Кто мог менять пользователей — сохраняет право удаления.
insert into public.role_permissions (role_id, permission_id)
select distinct rp.role_id, p.id
from public.role_permissions rp
join public.permissions existing on existing.id = rp.permission_id
join public.permissions p on p.code = 'users:delete'
where existing.code = 'users:update'
on conflict do nothing;

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
  item_is_permanent boolean default true,
  item_min_stock numeric default 0
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
  min_qty numeric := greatest(0, round(coalesce(item_min_stock, 0)));
begin
  if not (
    public.has_permission('inventory:update')
    or public.has_permission('inventory:receive')
  ) then
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

  if coalesce(item_min_stock, 0) < 0
     or coalesce(item_min_stock, 0) <> round(coalesce(item_min_stock, 0)) then
    raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
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
    is_permanent = permanent,
    min_stock = min_qty
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
    jsonb_build_object(
      'name', clean_name,
      'code', next_code,
      'is_permanent', permanent,
      'min_stock', min_qty
    )
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
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
  if not (
    public.has_permission('inventory:delete')
    or public.has_permission('inventory:receive')
  ) then
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
  allowed boolean;
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
  elsif target_entity_code = 'inventory' then
    permission_code := 'inventory:update';
  elsif target_entity_code = 'order_work' then
    permission_code := 'orders:update';
  end if;

  allowed := public.has_permission(permission_code);
  if not allowed and target_entity_code = 'inventory' then
    allowed := public.has_permission('inventory:receive');
  end if;

  if not allowed then
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
  if not (
    public.has_permission('users:delete')
    or public.has_permission('users:update')
  ) then
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

-- -----------------------------------------------------------------------------
-- [38/60 | was 129/151] 20260829997000_task_assign_any_employee.sql
-- -----------------------------------------------------------------------------

-- Назначение исполнителя при создании/редактировании доступно всем с tasks:create/update.
-- tasks:manage_others остаётся для просмотра и правок чужих задач в списках.
-- Автор задачи может менять её и после переназначения.

drop function if exists public.can_mutate_task(uuid);

create or replace function public.can_mutate_task(assignee_id uuid, created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_tasks_manage_others()
    or assignee_id = auth.uid()
    or created_by = auth.uid();
$$;

create or replace function public.create_task(
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

create or replace function public.update_task(
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

  if not public.can_mutate_task(current_row.assignee_id, current_row.created_by) then
    raise exception 'Недостаточно прав для изменения чужой или общей задачи.';
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

create or replace function public.set_task_completed(
  target_task_id uuid,
  p_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.tasks%rowtype;
  next_completed boolean := coalesce(p_completed, false);
begin
  perform public.assert_tasks_update();

  select * into current_row
  from public.tasks
  where id = target_task_id
  for update;

  if current_row.id is null then
    raise exception 'Задача не найдена.';
  end if;

  if not public.can_mutate_task(current_row.assignee_id, current_row.created_by) then
    raise exception 'Недостаточно прав для изменения чужой или общей задачи.';
  end if;

  if current_row.completed is not distinct from next_completed then
    return;
  end if;

  if next_completed then
    update public.tasks
    set completed = true,
        completed_at = now()
    where id = target_task_id;

    if current_row.order_id is not null then
      perform public.write_task_order_journal(
        current_row.order_id,
        'task_completed',
        'Задача «' || left(current_row.title, 120) || '» выполнена',
        jsonb_build_object('task_id', current_row.id, 'title', current_row.title)
      );
    end if;
  else
    update public.tasks
    set completed = false,
        completed_at = null
    where id = target_task_id;
  end if;

  perform public.record_audit(
    case when next_completed then 'task.completed' else 'task.reopened' end,
    'task',
    target_task_id::text,
    jsonb_build_object('order_id', current_row.order_id)
  );
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

  if not public.can_mutate_task(current_row.assignee_id, current_row.created_by) then
    raise exception 'Недостаточно прав для удаления чужой или общей задачи.';
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

revoke all on function public.can_mutate_task(uuid, uuid) from public, anon;
grant execute on function public.can_mutate_task(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [39/60 | was 130/151] 20261016120000_return_inventory_clamp.sql
-- -----------------------------------------------------------------------------

-- Возврат на склад при уменьшении состава: не больше фактически списанного,
-- без ошибки — лишнее просто не возвращаем (остаток не уходит ниже нуля).

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
    return;
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
    if take <= 0 then
      continue;
    end if;

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

  -- Если списаний меньше запрошенного возврата (импорт, shortage и т.п.) —
  -- молча ограничиваем возврат доступным количеством.
end;
$$;

-- -----------------------------------------------------------------------------
-- [40/60 | was 131/151] 20261016123000_align_permission_matrix_checks.sql
-- -----------------------------------------------------------------------------

-- Матрица ролей и реальные проверки прав: отдельные чекбоксы «Изменение» / «Удаление»
-- больше не подменяются правом «Создание» (inventory:receive) или «users:update».

-- Убрать старую перегрузку без min_stock (там ещё был обход через inventory:receive).
drop function if exists public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean
);

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
  item_is_permanent boolean default true,
  item_min_stock numeric default 0
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
  min_qty numeric := greatest(0, round(coalesce(item_min_stock, 0)));
begin
  if not public.has_permission('inventory:update') then
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

  if coalesce(item_min_stock, 0) < 0
     or coalesce(item_min_stock, 0) <> round(coalesce(item_min_stock, 0)) then
    raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
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
    is_permanent = permanent,
    min_stock = min_qty
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
    jsonb_build_object(
      'name', clean_name,
      'code', next_code,
      'is_permanent', permanent,
      'min_stock', min_qty
    )
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
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
  if not public.has_permission('inventory:delete') then
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

CREATE OR REPLACE FUNCTION public.save_dynamic_field_values(target_entity_code text, target_record_id uuid, field_values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  field_row public.dynamic_fields%rowtype;
  raw jsonb;
  permission_code text;
  journal_enabled boolean := false;
  old_fields jsonb := '{}'::jsonb;
  changes jsonb := '[]'::jsonb;
  old_value jsonb;
  new_value jsonb;
  old_norm text;
  new_norm text;
  summary_text text;
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
  elsif target_entity_code = 'inventory' then
    permission_code := 'inventory:update';
  elsif target_entity_code = 'order_work' then
    permission_code := 'orders:update';
  elsif target_entity_code = 'devices' then
    if not (
      public.has_permission('devices:update')
      or public.has_permission('settings:update')
    ) then
      raise exception 'Недостаточно прав для сохранения полей.';
    end if;
    permission_code := null;
  end if;

  if permission_code is not null and not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
  end if;

  journal_enabled :=
    target_entity_code in ('order_work', 'orders')
    and exists (select 1 from public.orders where id = target_record_id);

  if journal_enabled then
    select coalesce(jsonb_object_agg(f.code, v.value), '{}'::jsonb)
      into old_fields
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id and v.record_id = target_record_id
    where f.entity_code = target_entity_code
      and f.is_active = true
      and not public.is_order_card_field(f.entity_code, f.code);
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
      new_value := null;
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
      new_value := raw;
    end if;

    if journal_enabled then
      old_value := old_fields -> field_row.code;
      old_norm := public.normalize_dynamic_field_journal_value(old_value);
      new_norm := public.normalize_dynamic_field_journal_value(new_value);

      if old_norm is distinct from new_norm then
        changes := changes || jsonb_build_array(jsonb_build_object(
          'field', field_row.code,
          'label', field_row.name,
          'from', to_jsonb(old_norm),
          'to', to_jsonb(new_norm)
        ));
      end if;
    end if;
  end loop;

  if journal_enabled and jsonb_array_length(changes) > 0 then
    summary_text := case
      when target_entity_code = 'order_work' then 'Изменены поля состава работы'
      else 'Изменения в заказе'
    end;

    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      target_record_id,
      'order_updated',
      auth.uid(),
      summary_text,
      jsonb_build_object('changes', changes)
    );

    perform public.record_audit(
      'orders.updated',
      'order',
      target_record_id::text,
      jsonb_build_object(
        'entity_code', target_entity_code,
        'changes', changes
      )
    );
  end if;
end;
$function$;

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
  if not public.has_permission('users:delete') then
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

-- -----------------------------------------------------------------------------
-- [41/60 | was 132/151] 20261019114000_inventory_item_barcode_type_on_save.sql
-- -----------------------------------------------------------------------------

-- Штрихкод и тип этикетки сохраняются вместе с карточкой (кнопка «Сохранить»),
-- а не отдельным автосейвом. Права на этикетку = inventory:update.
-- Колонка min_stock обязательна до пересоздания update_inventory_item.

alter table public.inventory_items
  add column if not exists min_stock numeric(14, 0) not null default 0;

do $grant$
begin
  execute $sql$
    grant execute on function public.update_inventory_item(
      uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
    ) to authenticated
  $sql$;
exception
  when undefined_function then
    null;
end;
$grant$;

drop function if exists public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
);
drop function if exists public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
);

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
  item_is_permanent boolean default true,
  item_min_stock numeric default 0,
  item_barcode_type text default 'code128'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_code text;
  min_qty numeric := greatest(0, round(coalesce(item_min_stock, 0)));
  safe_type text;
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

  if coalesce(item_min_stock, 0) < 0
     or coalesce(item_min_stock, 0) <> round(coalesce(item_min_stock, 0)) then
    raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
  end if;

  safe_type := lower(btrim(coalesce(item_barcode_type, 'code128')));
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    next_code := 'N-' || lpad(nextval('public.inventory_item_code_seq')::text, 6, '0');
  end if;

  insert into public.inventory_items (
    code, article, barcode, barcode_type, name, description, category_id, unit_id,
    purchase_price, repair_price, retail_price, is_permanent, min_stock
  )
  values (
    next_code,
    btrim(coalesce(item_article, '')),
    btrim(coalesce(item_barcode, '')),
    safe_type,
    btrim(item_name),
    btrim(coalesce(item_description, '')),
    item_category_id,
    item_unit_id,
    coalesce(item_purchase_price, 0),
    coalesce(item_repair_price, 0),
    coalesce(item_retail_price, 0),
    coalesce(item_is_permanent, true),
    min_qty
  )
  returning id into result_id;

  perform public.record_audit(
    'inventory.item_created',
    'inventory_item',
    result_id::text,
    jsonb_build_object(
      'name', btrim(item_name),
      'code', next_code,
      'is_permanent', coalesce(item_is_permanent, true),
      'min_stock', min_qty,
      'barcode_type', safe_type
    )
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
  item_is_permanent boolean default true,
  item_min_stock numeric default null,
  item_barcode_type text default null
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
  current_min numeric;
  current_type text;
  min_qty numeric;
  safe_type text;
begin
  if not public.has_permission('inventory:update') then
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

  select min_stock, barcode_type
    into current_min, current_type
  from public.inventory_items
  where id = target_item_id;

  if item_min_stock is null then
    min_qty := greatest(0, round(coalesce(current_min, 0)));
  else
    if item_min_stock < 0 or item_min_stock <> round(item_min_stock) then
      raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
    end if;
    min_qty := greatest(0, round(item_min_stock));
  end if;

  if item_barcode_type is null or btrim(item_barcode_type) = '' then
    safe_type := lower(btrim(coalesce(current_type, 'code128')));
  else
    safe_type := lower(btrim(item_barcode_type));
  end if;
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
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
    barcode_type = safe_type,
    name = clean_name,
    description = btrim(coalesce(item_description, '')),
    category_id = item_category_id,
    unit_id = item_unit_id,
    purchase_price = coalesce(item_purchase_price, 0),
    repair_price = clean_repair,
    retail_price = coalesce(item_retail_price, 0),
    is_permanent = permanent,
    min_stock = min_qty,
    updated_at = now()
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
    jsonb_build_object(
      'name', clean_name,
      'code', next_code,
      'is_permanent', permanent,
      'min_stock', min_qty,
      'barcode_type', safe_type
    )
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
end;
$$;

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
  if not public.has_permission('inventory:update') then
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

revoke all on function public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) from public, anon;
revoke all on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) from public, anon;
revoke all on function public.set_inventory_item_label(uuid, text, text) from public, anon;

grant execute on function public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) to authenticated;
grant execute on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) to authenticated;
grant execute on function public.set_inventory_item_label(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [42/60 | was 133/151] 20261019123000_inventory_items_min_stock_column.sql
-- -----------------------------------------------------------------------------

-- На проде не было колонки min_stock, а update_inventory_item уже её пишет → 42703.

alter table public.inventory_items
  add column if not exists min_stock numeric(14, 0) not null default 0;

do $chk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_items_min_stock_check'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_min_stock_check check (min_stock >= 0);
  end if;
end;
$chk$;

comment on column public.inventory_items.min_stock is
  'Минимальный остаток: при остатке ≤ минимума (и min_stock > 0) позиция в фильтре «Ниже минимума».';

-- Пересоздать update без зависимости от «забытой» колонки и с гарантированным GRANT.
drop function if exists public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
);
drop function if exists public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
);
drop function if exists public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean
);

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
  item_is_permanent boolean default true,
  item_min_stock numeric default null,
  item_barcode_type text default null
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
  current_min numeric;
  current_type text;
  min_qty numeric;
  safe_type text;
begin
  if not public.has_permission('inventory:update') then
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

  select i.min_stock, i.barcode_type
    into current_min, current_type
  from public.inventory_items i
  where i.id = target_item_id;

  if item_min_stock is null then
    min_qty := greatest(0, round(coalesce(current_min, 0)));
  else
    if item_min_stock < 0 or item_min_stock <> round(item_min_stock) then
      raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
    end if;
    min_qty := greatest(0, round(item_min_stock));
  end if;

  if item_barcode_type is null or btrim(item_barcode_type) = '' then
    safe_type := lower(btrim(coalesce(current_type, 'code128')));
  else
    safe_type := lower(btrim(item_barcode_type));
  end if;
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
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
    barcode_type = safe_type,
    name = clean_name,
    description = btrim(coalesce(item_description, '')),
    category_id = item_category_id,
    unit_id = item_unit_id,
    purchase_price = coalesce(item_purchase_price, 0),
    repair_price = clean_repair,
    retail_price = coalesce(item_retail_price, 0),
    is_permanent = permanent,
    min_stock = min_qty,
    updated_at = now()
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
    jsonb_build_object(
      'name', clean_name,
      'code', next_code,
      'is_permanent', permanent,
      'min_stock', min_qty,
      'barcode_type', safe_type
    )
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
end;
$$;

revoke all on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) from public, anon;

grant execute on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) to authenticated;

-- Чтобы PostgREST подхватил новую сигнатуру / права.
notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [43/60 | was 134/151] 20261019150800_drop_inventory_item_rpc_overloads.sql
-- -----------------------------------------------------------------------------

-- PostgREST: «Could not choose the best candidate function» —
-- после добавления параметров со default остались старые перегрузки
-- create/update_inventory_item. Удаляем ВСЕ, оставляем одну сигнатуру.

do $drop$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_inventory_item', 'update_inventory_item')
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end;
$drop$;

alter table public.inventory_items
  add column if not exists min_stock numeric(14, 0) not null default 0;

alter table public.inventory_items
  add column if not exists barcode_type text not null default 'code128';

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
  item_is_permanent boolean default true,
  item_min_stock numeric default 0,
  item_barcode_type text default 'code128'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_code text;
  min_qty numeric := greatest(0, round(coalesce(item_min_stock, 0)));
  safe_type text;
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

  if coalesce(item_min_stock, 0) < 0
     or coalesce(item_min_stock, 0) <> round(coalesce(item_min_stock, 0)) then
    raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
  end if;

  safe_type := lower(btrim(coalesce(item_barcode_type, 'code128')));
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    next_code := 'N-' || lpad(nextval('public.inventory_item_code_seq')::text, 6, '0');
  end if;

  insert into public.inventory_items (
    code, article, barcode, barcode_type, name, description, category_id, unit_id,
    purchase_price, repair_price, retail_price, is_permanent, min_stock
  )
  values (
    next_code,
    btrim(coalesce(item_article, '')),
    btrim(coalesce(item_barcode, '')),
    safe_type,
    btrim(item_name),
    btrim(coalesce(item_description, '')),
    item_category_id,
    item_unit_id,
    coalesce(item_purchase_price, 0),
    coalesce(item_repair_price, 0),
    coalesce(item_retail_price, 0),
    coalesce(item_is_permanent, true),
    min_qty
  )
  returning id into result_id;

  perform public.record_audit(
    'inventory.item_created',
    'inventory_item',
    result_id::text,
    jsonb_build_object(
      'name', btrim(item_name),
      'code', next_code,
      'is_permanent', coalesce(item_is_permanent, true),
      'min_stock', min_qty,
      'barcode_type', safe_type
    )
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
  item_is_permanent boolean default true,
  item_min_stock numeric default null,
  item_barcode_type text default null
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
  current_min numeric;
  current_type text;
  min_qty numeric;
  safe_type text;
begin
  if not public.has_permission('inventory:update') then
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

  select i.min_stock, i.barcode_type
    into current_min, current_type
  from public.inventory_items i
  where i.id = target_item_id;

  if item_min_stock is null then
    min_qty := greatest(0, round(coalesce(current_min, 0)));
  else
    if item_min_stock < 0 or item_min_stock <> round(item_min_stock) then
      raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
    end if;
    min_qty := greatest(0, round(item_min_stock));
  end if;

  if item_barcode_type is null or btrim(item_barcode_type) = '' then
    safe_type := lower(btrim(coalesce(current_type, 'code128')));
  else
    safe_type := lower(btrim(item_barcode_type));
  end if;
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
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
    barcode_type = safe_type,
    name = clean_name,
    description = btrim(coalesce(item_description, '')),
    category_id = item_category_id,
    unit_id = item_unit_id,
    purchase_price = coalesce(item_purchase_price, 0),
    repair_price = clean_repair,
    retail_price = coalesce(item_retail_price, 0),
    is_permanent = permanent,
    min_stock = min_qty,
    updated_at = now()
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
    jsonb_build_object(
      'name', clean_name,
      'code', next_code,
      'is_permanent', permanent,
      'min_stock', min_qty,
      'barcode_type', safe_type
    )
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
end;
$$;

revoke all on function public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) from public, anon;
revoke all on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) from public, anon;

grant execute on function public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) to authenticated;
grant execute on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [44/60 | was 135/151] 20261019153000_document_context_order_work_fields.sql
-- -----------------------------------------------------------------------------

-- Контекст документа по заказу: доп. поля раздела «Состав работы» (order_work).
-- Значения хранятся на заказе (entity_code = order_work, record_id = order_id),
-- но раньше в build_document_context не попадали — плейсхолдеры field.order_work.*
-- оставались пустыми при печати / создании документа.

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
        'order.total', trim(to_char(public.order_total_amount(o.id), '999999990.99')),
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
      || public.document_dynamic_field_values('order_work', p_source_id)
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
        coalesce(nullif(btrim(l.name), ''), i.name, '') as item_name,
        coalesce(i.code, '') as item_code,
        coalesce(i.article, '') as item_article,
        trim(to_char(l.quantity, '999999990.999')) as quantity,
        coalesce(u.name, 'шт') as unit_name,
        trim(to_char(l.unit_price, '999999990.99')) as unit_price,
        l.created_at
      from public.order_part_lines l
      left join public.inventory_items i on i.id = l.item_id
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

-- -----------------------------------------------------------------------------
-- [45/60 | was 136/151] 20261020120000_label_part_card_layout.sql
-- -----------------------------------------------------------------------------

-- Системная «Этикетка запчасти»: HTML-макет как на карточке склада (58×40 мм).

update public.document_templates
set
  name = 'Этикетка запчасти',
  kind = 'label',
  page_size = 'label',
  body = $json$
  [
    {
      "id": "label-part-html",
      "type": "html",
      "margins": { "top": 2.5, "right": 2.5, "bottom": 2.5, "left": 2.5 },
      "html": "<div class=\"item-label-layout\" style=\"display: flex; flex-direction: column; box-sizing: border-box; height: 100%; text-align: center; font-family: Arial, Helvetica, sans-serif; color: #000;\"><p class=\"item-label-title\" style=\"margin: 0; padding: 0; font-size: 8pt; font-weight: 600; line-height: 1.15; word-break: break-word;\"><span class=\"doc-field\" data-field=\"item.name\">Уплотнитель канала</span></p><p class=\"item-label-meta\" style=\"margin: 0.6mm 0 0; padding: 0; font-size: 6.5pt; font-weight: 400; line-height: 1.15; color: #404040; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\"><span class=\"doc-field\" data-field=\"item.labelMeta\">Код INV-000001 · Арт. ART-100</span></p><div class=\"item-label-barcode\" style=\"display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; justify-content: center; min-height: 0; margin: 1.5mm 0 0; padding: 0;\"><span class=\"doc-barcode\" data-code=\"{{item.barcode}}\">Штрихкод</span></div></div>"
    }
  ]
  $json$::jsonb,
  updated_at = now()
where code = 'label_part'
  and deleted_at is null;

insert into public.document_templates (code, name, kind, page_size, is_system, body)
select
  'label_part',
  'Этикетка запчасти',
  'label',
  'label',
  true,
  $json$
  [
    {
      "id": "label-part-html",
      "type": "html",
      "margins": { "top": 2.5, "right": 2.5, "bottom": 2.5, "left": 2.5 },
      "html": "<div class=\"item-label-layout\" style=\"display: flex; flex-direction: column; box-sizing: border-box; height: 100%; text-align: center; font-family: Arial, Helvetica, sans-serif; color: #000;\"><p class=\"item-label-title\" style=\"margin: 0; padding: 0; font-size: 8pt; font-weight: 600; line-height: 1.15; word-break: break-word;\"><span class=\"doc-field\" data-field=\"item.name\">Уплотнитель канала</span></p><p class=\"item-label-meta\" style=\"margin: 0.6mm 0 0; padding: 0; font-size: 6.5pt; font-weight: 400; line-height: 1.15; color: #404040; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\"><span class=\"doc-field\" data-field=\"item.labelMeta\">Код INV-000001 · Арт. ART-100</span></p><div class=\"item-label-barcode\" style=\"display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; justify-content: center; min-height: 0; margin: 1.5mm 0 0; padding: 0;\"><span class=\"doc-barcode\" data-code=\"{{item.barcode}}\">Штрихкод</span></div></div>"
    }
  ]
  $json$::jsonb
where not exists (
  select 1
  from public.document_templates t
  where t.code = 'label_part'
    and t.deleted_at is null
);

-- -----------------------------------------------------------------------------
-- [46/60 | was 137/151] 20261020124500_label_part_card_preview_layout.sql
-- -----------------------------------------------------------------------------

-- Макет «Этикетка запчасти» как на карточке: название, код/артикул, штрихкод на всю высоту.

update public.document_templates
set
  body = $json$
  [
    {
      "id": "label-part-html",
      "type": "html",
      "margins": { "top": 2.5, "right": 2.5, "bottom": 2.5, "left": 2.5 },
      "html": "<div class=\"item-label-layout\" style=\"display: flex; flex-direction: column; box-sizing: border-box; height: 100%; text-align: center; font-family: Arial, Helvetica, sans-serif; color: #000;\"><p class=\"item-label-title\" style=\"margin: 0; padding: 0; font-size: 8pt; font-weight: 600; line-height: 1.15; word-break: break-word;\"><span class=\"doc-field\" data-field=\"item.name\">Уплотнитель канала</span></p><p class=\"item-label-meta\" style=\"margin: 0.6mm 0 0; padding: 0; font-size: 6.5pt; font-weight: 400; line-height: 1.15; color: #404040; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\"><span class=\"doc-field\" data-field=\"item.labelMeta\">Код INV-000001 · Арт. ART-100</span></p><div class=\"item-label-barcode\" style=\"display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; justify-content: center; min-height: 0; margin: 1.5mm 0 0; padding: 0;\"><span class=\"doc-barcode\" data-code=\"{{item.barcode}}\">Штрихкод</span></div></div>"
    }
  ]
  $json$::jsonb,
  updated_at = now()
where code = 'label_part'
  and deleted_at is null;

-- -----------------------------------------------------------------------------
-- [47/60 | was 138/151] 20261022113000_document_template_assets.sql
-- -----------------------------------------------------------------------------

-- Картинки для шаблонов документов (логотипы и изображения).
-- Публичный bucket: URL стабилен при печати и в сохранённых шаблонах.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-template-assets',
  'document-template-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists document_template_assets_select on storage.objects;
create policy document_template_assets_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'document-template-assets');

drop policy if exists document_template_assets_insert on storage.objects;
create policy document_template_assets_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'document-template-assets'
    and public.has_permission('documents:edit_templates')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists document_template_assets_update on storage.objects;
create policy document_template_assets_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'document-template-assets'
    and public.has_permission('documents:edit_templates')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'document-template-assets'
    and public.has_permission('documents:edit_templates')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists document_template_assets_delete on storage.objects;
create policy document_template_assets_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'document-template-assets'
    and public.has_permission('documents:edit_templates')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- [48/60 | was 139/151] 20261022120000_list_sort_receipts_sales_writeoffs.sql
-- -----------------------------------------------------------------------------

-- Сортировка списков приходов / продаж / списаний по колонкам (как в заказах).

-- ─── Приходы ────────────────────────────────────────────────────────────────

drop function if exists public.list_inventory_receipts(integer, integer, text, timestamptz, timestamptz);
drop function if exists public.list_inventory_receipts(integer, integer, text, timestamptz, timestamptz, text, text);

create or replace function public.list_inventory_receipts(
  page_number integer default 1,
  page_size integer default 20,
  status_filter text default 'all',
  created_from timestamptz default null,
  created_to timestamptz default null,
  sort_by text default 'created',
  sort_dir text default 'desc'
)
returns table (
  id uuid,
  supplier text,
  supplier_id uuid,
  receipt_date date,
  notes text,
  status text,
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
  status_value text;
  sort_col text;
  sort_asc boolean;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра приходов.';
  end if;

  status_value := coalesce(nullif(btrim(status_filter), ''), 'all');
  if status_value not in ('all', 'draft', 'posted') then
    raise exception 'Неизвестный фильтр статуса.';
  end if;

  sort_col := lower(coalesce(nullif(btrim(sort_by), ''), 'created'));
  if sort_col not in ('date', 'status', 'supplier', 'lines', 'qty', 'actor', 'created') then
    sort_col := 'created';
  end if;
  sort_asc := lower(coalesce(nullif(btrim(sort_dir), ''), 'desc')) = 'asc';

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    r.id,
    r.supplier,
    r.supplier_id,
    r.receipt_date,
    r.notes,
    r.status,
    r.created_at,
    coalesce(p.full_name, '') as actor_name,
    case
      when r.status = 'draft' then coalesce(jsonb_array_length(r.draft_lines), 0)::bigint
      else count(m.id)
    end as line_count,
    case
      when r.status = 'draft' then coalesce((
        select sum((line_row.elem ->> 'quantity')::numeric)
        from jsonb_array_elements(r.draft_lines) as line_row(elem)
      ), 0)
      else coalesce(sum(m.quantity), 0)
    end as total_quantity,
    count(*) over() as total_count
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  left join public.inventory_movements m
    on m.reference_type = 'receipt'
   and m.reference_id = r.id
   and m.movement_type = 'receipt'
   and r.status = 'posted'
  where r.hidden_at is null
    and (status_value = 'all' or r.status = status_value)
    and (created_from is null or r.created_at >= created_from)
    and (created_to is null or r.created_at < created_to)
  group by r.id, r.supplier, r.supplier_id, r.receipt_date, r.notes, r.status, r.draft_lines, r.created_at, p.full_name
  order by
    case when sort_col = 'created' and not sort_asc then case when r.status = 'draft' then 0 else 1 end end,
    case when sort_col = 'date' and sort_asc then r.receipt_date end asc nulls last,
    case when sort_col = 'date' and not sort_asc then r.receipt_date end desc nulls last,
    case when sort_col = 'status' and sort_asc then r.status end asc nulls last,
    case when sort_col = 'status' and not sort_asc then r.status end desc nulls last,
    case when sort_col = 'supplier' and sort_asc then r.supplier end asc nulls last,
    case when sort_col = 'supplier' and not sort_asc then r.supplier end desc nulls last,
    case when sort_col = 'lines' and sort_asc then
      case when r.status = 'draft' then coalesce(jsonb_array_length(r.draft_lines), 0)::bigint else count(m.id) end
    end asc nulls last,
    case when sort_col = 'lines' and not sort_asc then
      case when r.status = 'draft' then coalesce(jsonb_array_length(r.draft_lines), 0)::bigint else count(m.id) end
    end desc nulls last,
    case when sort_col = 'qty' and sort_asc then
      case
        when r.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric)
          from jsonb_array_elements(r.draft_lines) as line_row(elem)
        ), 0)
        else coalesce(sum(m.quantity), 0)
      end
    end asc nulls last,
    case when sort_col = 'qty' and not sort_asc then
      case
        when r.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric)
          from jsonb_array_elements(r.draft_lines) as line_row(elem)
        ), 0)
        else coalesce(sum(m.quantity), 0)
      end
    end desc nulls last,
    case when sort_col = 'actor' and sort_asc then coalesce(p.full_name, '') end asc nulls last,
    case when sort_col = 'actor' and not sort_asc then coalesce(p.full_name, '') end desc nulls last,
    case when sort_col = 'created' and sort_asc then r.created_at end asc nulls last,
    case when sort_col = 'created' and not sort_asc then r.created_at end desc nulls last,
    r.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.list_inventory_receipts(integer, integer, text, timestamptz, timestamptz, text, text)
  from public, anon;
grant execute on function public.list_inventory_receipts(integer, integer, text, timestamptz, timestamptz, text, text)
  to authenticated;

-- ─── Списания ───────────────────────────────────────────────────────────────

drop function if exists public.list_inventory_write_offs(integer, integer);
drop function if exists public.list_inventory_write_offs(integer, integer, text, text);

create or replace function public.list_inventory_write_offs(
  page_number integer default 1,
  page_size integer default 20,
  sort_by text default 'created',
  sort_dir text default 'desc'
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
  sort_col text;
  sort_asc boolean;
begin
  if not (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для просмотра списаний.';
  end if;

  sort_col := lower(coalesce(nullif(btrim(sort_by), ''), 'created'));
  if sort_col not in ('date', 'reason', 'lines', 'qty', 'amount', 'actor', 'created') then
    sort_col := 'created';
  end if;
  sort_asc := lower(coalesce(nullif(btrim(sort_dir), ''), 'desc')) = 'asc';

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
  order by
    case when sort_col = 'date' and sort_asc then w.write_off_date end asc nulls last,
    case when sort_col = 'date' and not sort_asc then w.write_off_date end desc nulls last,
    case when sort_col = 'reason' and sort_asc then w.reason end asc nulls last,
    case when sort_col = 'reason' and not sort_asc then w.reason end desc nulls last,
    case when sort_col = 'lines' and sort_asc then count(distinct m.item_id) end asc nulls last,
    case when sort_col = 'lines' and not sort_asc then count(distinct m.item_id) end desc nulls last,
    case when sort_col = 'qty' and sort_asc then
      coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0)
    end asc nulls last,
    case when sort_col = 'qty' and not sort_asc then
      coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0)
    end desc nulls last,
    case when sort_col = 'amount' and sort_asc then
      coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0)
    end asc nulls last,
    case when sort_col = 'amount' and not sort_asc then
      coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0)
    end desc nulls last,
    case when sort_col = 'actor' and sort_asc then coalesce(p.full_name, '') end asc nulls last,
    case when sort_col = 'actor' and not sort_asc then coalesce(p.full_name, '') end desc nulls last,
    case when sort_col = 'created' and sort_asc then w.created_at end asc nulls last,
    case when sort_col = 'created' and not sort_asc then w.created_at end desc nulls last,
    w.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.list_inventory_write_offs(integer, integer, text, text) from public, anon;
grant execute on function public.list_inventory_write_offs(integer, integer, text, text) to authenticated;

-- ─── Продажи ────────────────────────────────────────────────────────────────

drop function if exists public.list_sales(text, text, integer, integer);
drop function if exists public.list_sales(text, text, integer, integer, text, text);

create or replace function public.list_sales(
  search_query text default '',
  status_filter text default '',
  page_number integer default 1,
  page_size integer default 20,
  sort_by text default 'created',
  sort_dir text default 'desc'
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
  sort_col text;
  sort_asc boolean;
begin
  perform public.assert_sales_read();

  status_value := coalesce(nullif(btrim(status_filter), ''), '');
  if status_value <> '' and status_value not in ('draft', 'confirmed', 'cancelled') then
    raise exception 'Неизвестный статус продажи.';
  end if;

  sort_col := lower(coalesce(nullif(btrim(sort_by), ''), 'created'));
  if sort_col not in ('invoice', 'customer', 'date', 'total', 'status', 'actor', 'created') then
    sort_col := 'created';
  end if;
  sort_asc := lower(coalesce(nullif(btrim(sort_dir), ''), 'desc')) = 'asc';

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
  order by
    case when sort_col = 'invoice' and sort_asc then s.invoice_number end asc nulls last,
    case when sort_col = 'invoice' and not sort_asc then s.invoice_number end desc nulls last,
    case when sort_col = 'customer' and sort_asc then coalesce(c.name, '') end asc nulls last,
    case when sort_col = 'customer' and not sort_asc then coalesce(c.name, '') end desc nulls last,
    case when sort_col = 'date' and sort_asc then s.sale_date end asc nulls last,
    case when sort_col = 'date' and not sort_asc then s.sale_date end desc nulls last,
    case when sort_col = 'total' and sort_asc then s.total end asc nulls last,
    case when sort_col = 'total' and not sort_asc then s.total end desc nulls last,
    case when sort_col = 'status' and sort_asc then s.status end asc nulls last,
    case when sort_col = 'status' and not sort_asc then s.status end desc nulls last,
    case when sort_col = 'actor' and sort_asc then coalesce(p.full_name, '') end asc nulls last,
    case when sort_col = 'actor' and not sort_asc then coalesce(p.full_name, '') end desc nulls last,
    case when sort_col = 'created' and sort_asc then s.created_at end asc nulls last,
    case when sort_col = 'created' and not sort_asc then s.created_at end desc nulls last,
    s.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.list_sales(text, text, integer, integer, text, text) from public, anon;
grant execute on function public.list_sales(text, text, integer, integer, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [49/60 | was 140/151] 20261022123000_list_sales_created_period.sql
-- -----------------------------------------------------------------------------

-- Фильтр списка продаж по периоду создания (как у приходов).

drop function if exists public.list_sales(text, text, integer, integer, text, text);
drop function if exists public.list_sales(text, text, integer, integer, text, text, timestamptz, timestamptz);

create or replace function public.list_sales(
  search_query text default '',
  status_filter text default '',
  page_number integer default 1,
  page_size integer default 20,
  sort_by text default 'created',
  sort_dir text default 'desc',
  created_from timestamptz default null,
  created_to timestamptz default null
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
  sort_col text;
  sort_asc boolean;
begin
  perform public.assert_sales_read();

  status_value := coalesce(nullif(btrim(status_filter), ''), '');
  if status_value <> '' and status_value not in ('draft', 'confirmed', 'cancelled') then
    raise exception 'Неизвестный статус продажи.';
  end if;

  sort_col := lower(coalesce(nullif(btrim(sort_by), ''), 'created'));
  if sort_col not in ('invoice', 'customer', 'date', 'total', 'status', 'actor', 'created') then
    sort_col := 'created';
  end if;
  sort_asc := lower(coalesce(nullif(btrim(sort_dir), ''), 'desc')) = 'asc';

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
    and (created_from is null or s.created_at >= created_from)
    and (created_to is null or s.created_at < created_to)
    and (
      btrim(coalesce(search_query, '')) = ''
      or s.invoice_number ilike term escape '\'
      or c.name ilike term escape '\'
    )
  order by
    case when sort_col = 'invoice' and sort_asc then s.invoice_number end asc nulls last,
    case when sort_col = 'invoice' and not sort_asc then s.invoice_number end desc nulls last,
    case when sort_col = 'customer' and sort_asc then coalesce(c.name, '') end asc nulls last,
    case when sort_col = 'customer' and not sort_asc then coalesce(c.name, '') end desc nulls last,
    case when sort_col = 'date' and sort_asc then s.sale_date end asc nulls last,
    case when sort_col = 'date' and not sort_asc then s.sale_date end desc nulls last,
    case when sort_col = 'total' and sort_asc then s.total end asc nulls last,
    case when sort_col = 'total' and not sort_asc then s.total end desc nulls last,
    case when sort_col = 'status' and sort_asc then s.status end asc nulls last,
    case when sort_col = 'status' and not sort_asc then s.status end desc nulls last,
    case when sort_col = 'actor' and sort_asc then coalesce(p.full_name, '') end asc nulls last,
    case when sort_col = 'actor' and not sort_asc then coalesce(p.full_name, '') end desc nulls last,
    case when sort_col = 'created' and sort_asc then s.created_at end asc nulls last,
    case when sort_col = 'created' and not sort_asc then s.created_at end desc nulls last,
    s.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.list_sales(text, text, integer, integer, text, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.list_sales(text, text, integer, integer, text, text, timestamptz, timestamptz)
  to authenticated;

-- -----------------------------------------------------------------------------
-- [50/60 | was 141/151] 20261022130000_count_open_tasks_mine.sql
-- -----------------------------------------------------------------------------

-- Бейдж «Задачи» в навигации: только открытые задачи, назначенные текущему пользователю.

create or replace function public.count_open_tasks()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result bigint;
begin
  perform public.assert_tasks_read();
  select count(*) into result
  from public.tasks t
  where t.completed = false
    and t.assignee_id = auth.uid();
  return coalesce(result, 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- [51/60 | was 142/151] 20261022133000_document_template_assets_no_limits.sql
-- -----------------------------------------------------------------------------

-- Убрать лимиты размера и MIME для картинок шаблонов документов.

update storage.buckets
set
  file_size_limit = null,
  allowed_mime_types = null
where id = 'document-template-assets';

-- -----------------------------------------------------------------------------
-- [52/60 | was 143/151] 20261022140000_order_composition_journal.sql
-- -----------------------------------------------------------------------------

-- Журнал заказа: любое изменение состава работ (запчасти и услуги) → order_journal_events.

create or replace function public.remove_order_part_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
  line_name text;
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

  line_name := coalesce(
    nullif(btrim(current_row.name), ''),
    (select i.name from public.inventory_items i where i.id = current_row.item_id),
    'позиция'
  );

  if current_row.item_id is not null then
    perform public.return_inventory_from_order(
      current_row.order_id,
      current_row.item_id,
      current_row.quantity
    );
  end if;

  delete from public.order_part_lines
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'part_removed',
    auth.uid(),
    'Удалена позиция: ' || line_name || ' × ' || public.format_quantity_label(current_row.quantity),
    jsonb_build_object(
      'line_id', target_line_id,
      'item_id', current_row.item_id,
      'name', line_name,
      'quantity', current_row.quantity,
      'unit_price', current_row.unit_price,
      'custom', current_row.item_id is null
    )
  );

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
  line_name text;
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

  if current_row.quantity = line_quantity
     and current_row.unit_price = line_unit_price then
    return;
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
        false
      );
    elsif delta < 0 then
      perform public.return_inventory_from_order(current_row.order_id, current_row.item_id, -delta);
    end if;
  end if;

  line_name := coalesce(
    nullif(btrim(current_row.name), ''),
    (select i.name from public.inventory_items i where i.id = current_row.item_id),
    'позиция'
  );

  update public.order_part_lines
  set quantity = line_quantity,
      unit_price = line_unit_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'part_updated',
    auth.uid(),
    'Изменена позиция: ' || line_name
      || ' · '
      || public.format_quantity_label(current_row.quantity) || ' × '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || public.format_quantity_label(line_quantity) || ' × '
      || trim(to_char(line_unit_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'item_id', current_row.item_id,
      'name', line_name,
      'from_quantity', current_row.quantity,
      'to_quantity', line_quantity,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', line_unit_price,
      'custom', current_row.item_id is null
    )
  );

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

  if current_row.name = clean_name
     and current_row.quantity = line_quantity
     and current_row.unit_price = line_unit_price then
    return;
  end if;

  update public.order_part_lines
  set
    name = clean_name,
    quantity = line_quantity,
    unit_price = line_unit_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'part_updated',
    auth.uid(),
    'Изменена позиция: ' || clean_name
      || ' · '
      || public.format_quantity_label(current_row.quantity) || ' × '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || public.format_quantity_label(line_quantity) || ' × '
      || trim(to_char(line_unit_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'from_name', current_row.name,
      'from_quantity', current_row.quantity,
      'to_quantity', line_quantity,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', line_unit_price,
      'custom', true
    )
  );

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
  current_row public.order_service_lines%rowtype;
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

  select * into current_row
  from public.order_service_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Строка услуги не найдена.';
  end if;

  if current_row.quantity = line_quantity
     and current_row.unit_price = line_unit_price then
    return;
  end if;

  update public.order_service_lines
  set quantity = line_quantity, unit_price = line_unit_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'service_updated',
    auth.uid(),
    'Изменена услуга: ' || coalesce(current_row.name, 'услуга')
      || ' · '
      || public.format_quantity_label(current_row.quantity) || ' × '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || public.format_quantity_label(line_quantity) || ' × '
      || trim(to_char(line_unit_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'name', current_row.name,
      'from_quantity', current_row.quantity,
      'to_quantity', line_quantity,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', line_unit_price
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object('line_id', target_line_id, 'quantity', line_quantity, 'unit_price', line_unit_price)
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
  current_row public.order_service_lines%rowtype;
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

  select * into current_row
  from public.order_service_lines
  where id = target_line_id
    and template_id is null
  for update;

  if current_row.id is null then
    raise exception 'Строка услуги не найдена или это шаблон из справочника.';
  end if;

  if current_row.name = clean_name
     and coalesce(current_row.description, '') = clean_description
     and current_row.quantity = line_quantity
     and current_row.unit_price = line_unit_price then
    return;
  end if;

  update public.order_service_lines
  set
    name = clean_name,
    description = clean_description,
    quantity = line_quantity,
    unit_price = line_unit_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'service_updated',
    auth.uid(),
    'Изменена услуга: ' || clean_name
      || ' · '
      || public.format_quantity_label(current_row.quantity) || ' × '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || public.format_quantity_label(line_quantity) || ' × '
      || trim(to_char(line_unit_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'from_name', current_row.name,
      'from_quantity', current_row.quantity,
      'to_quantity', line_quantity,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', line_unit_price
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.custom_service_updated',
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

create or replace function public.update_order_service_line_for_order(
  target_line_id uuid,
  line_name text,
  line_description text default '',
  line_unit_price numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_service_lines%rowtype;
  clean_name text := btrim(coalesce(line_name, ''));
  clean_description text := btrim(coalesce(line_description, ''));
  clean_price numeric := coalesce(line_unit_price, 0);
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  select * into current_row
  from public.order_service_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Строка услуги в заказе не найдена.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if clean_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if current_row.name = clean_name
     and coalesce(current_row.description, '') = clean_description
     and current_row.unit_price = clean_price
     and current_row.template_id is null then
    return;
  end if;

  update public.order_service_lines
  set
    template_id = null,
    name = clean_name,
    description = clean_description,
    unit_price = clean_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'service_updated',
    auth.uid(),
    'Изменена услуга: ' || clean_name
      || ' · '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || trim(to_char(clean_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'from_name', current_row.name,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', clean_price,
      'previous_template_id', current_row.template_id
    )
  );

  perform public.record_audit(
    'orders.service_line_updated_local',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'previous_template_id', current_row.template_id,
      'name', clean_name,
      'unit_price', clean_price
    )
  );
end;
$$;

-- Добавление кастомной позиции: тип события как у остальных правок состава.
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
    'part_added',
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

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [53/60 | was 144/151] 20261022150000_fix_return_inventory_from_order.sql
-- -----------------------------------------------------------------------------

-- Возврат на склад при удалении/уменьшении позиции в заказе:
-- всегда создаём repair_return на полный объём (остаток + история карточки),
-- без тихого no-op, из‑за которого строка пропадала из заказа, а склад не менялся.

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
  capacity numeric;
  unit_price numeric;
  new_batch_id uuid;
  rows_inserted integer;
begin
  if return_quantity is null or return_quantity <= 0 then
    return;
  end if;

  if target_order_id is null or target_item_id is null then
    raise exception 'Не указан заказ или позиция для возврата на склад.';
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  perform 1
  from public.inventory_batches
  where item_id = target_item_id
  for update;

  remaining := return_quantity;

  -- 1) Откат по партиям, с которых это заказ реально списывал (с учётом ёмкости партии).
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

    select
      greatest(b.quantity - b.remaining_quantity, 0),
      b.purchase_price
    into capacity, unit_price
    from public.inventory_batches b
    where b.id = rec.batch_id;

    if capacity is null or capacity <= 0 then
      continue;
    end if;

    take := least(rec.net_qty, remaining, capacity);
    if take <= 0 then
      continue;
    end if;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      rec.batch_id,
      take,
      coalesce(unit_price, 0),
      'repair_return',
      'order',
      target_order_id,
      auth.uid()
    );

    get diagnostics rows_inserted = row_count;
    if rows_inserted <> 1 then
      raise exception 'Не удалось записать возврат на склад.';
    end if;

    remaining := remaining - take;
  end loop;

  -- 2) Остаток (импорт без списания / нет ёмкости в исходных партиях) —
  -- свободное место в других партиях позиции.
  if remaining > 0 then
    for rec in
      select
        b.id as batch_id,
        greatest(b.quantity - b.remaining_quantity, 0) as capacity,
        b.purchase_price
      from public.inventory_batches b
      where b.item_id = target_item_id
        and b.quantity > b.remaining_quantity
      order by b.receipt_date asc, b.created_at asc, b.id asc
    loop
      exit when remaining <= 0;

      take := least(rec.capacity, remaining);
      if take <= 0 then
        continue;
      end if;

      insert into public.inventory_movements (
        item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
      )
      values (
        target_item_id,
        rec.batch_id,
        take,
        coalesce(rec.purchase_price, 0),
        'repair_return',
        'order',
        target_order_id,
        auth.uid()
      );

      get diagnostics rows_inserted = row_count;
      if rows_inserted <> 1 then
        raise exception 'Не удалось записать возврат на склад.';
      end if;

      remaining := remaining - take;
    end loop;
  end if;

  -- 3) Всё ещё осталось — новая партия «Возврат из заказа» + движение repair_return.
  if remaining > 0 then
    select coalesce(i.purchase_price, 0)
    into unit_price
    from public.inventory_items i
    where i.id = target_item_id;

    if unit_price is null then
      raise exception 'Позиция склада не найдена.';
    end if;

    insert into public.inventory_batches (
      item_id,
      receipt_id,
      supplier,
      receipt_date,
      purchase_price,
      quantity,
      remaining_quantity
    )
    values (
      target_item_id,
      null,
      'Возврат из заказа',
      current_date,
      unit_price,
      remaining,
      0
    )
    returning id into new_batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      new_batch_id,
      remaining,
      unit_price,
      'repair_return',
      'order',
      target_order_id,
      auth.uid()
    );

    get diagnostics rows_inserted = row_count;
    if rows_inserted <> 1 then
      raise exception 'Не удалось записать возврат на склад.';
    end if;

    remaining := 0;
  end if;
end;
$$;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [54/60 | was 145/151] 20261022160000_upsert_device_reference_with_devices_create.sql
-- -----------------------------------------------------------------------------

-- Создание типа/производителя/модели/модификации прибора при приёмке:
-- достаточно devices:create (как у кладовщика), не только settings:update.

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
  set_code text;
  can_write_settings boolean;
  can_create_device_ref boolean;
begin
  select rs.code, rs.parent_set_id
  into set_code, parent_set
  from public.reference_sets rs
  where rs.id = target_set_id;

  if set_code is null then
    raise exception 'Справочник не найден.';
  end if;

  can_write_settings := public.has_permission('settings:update');
  can_create_device_ref :=
    target_id is null
    and public.has_permission('devices:create')
    and set_code in (
      'device_groups',
      'device_brands',
      'device_models',
      'device_modifications'
    );

  if not can_write_settings and not can_create_device_ref then
    raise exception 'Недостаточно прав для изменения справочника.';
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

-- -----------------------------------------------------------------------------
-- [55/60 | was 146/151] 20261026140000_inventory_write_off_drafts.sql
-- -----------------------------------------------------------------------------

-- Черновики списаний: сохранение без проведения на склад.

alter table public.inventory_write_offs
  add column if not exists status text not null default 'posted',
  add column if not exists draft_lines jsonb not null default '[]'::jsonb;

update public.inventory_write_offs
set status = 'posted'
where status is distinct from 'posted' and status is distinct from 'draft';

alter table public.inventory_write_offs
  drop constraint if exists inventory_write_offs_status_check;

alter table public.inventory_write_offs
  add constraint inventory_write_offs_status_check
  check (status in ('draft', 'posted'));

alter table public.inventory_write_offs
  drop constraint if exists inventory_write_offs_reason_present;

alter table public.inventory_write_offs
  add constraint inventory_write_offs_reason_present
  check (status = 'draft' or btrim(reason) <> '');

alter table public.inventory_write_offs
  drop constraint if exists inventory_write_offs_draft_lines_check;

alter table public.inventory_write_offs
  add constraint inventory_write_offs_draft_lines_check
  check (jsonb_typeof(draft_lines) = 'array');

create index if not exists inventory_write_offs_status_idx
  on public.inventory_write_offs (status, created_at desc)
  where hidden_at is null;

create or replace function public.save_inventory_write_off_draft(
  target_write_off_id uuid default null,
  doc_write_off_date date default current_date,
  reason_text text default '',
  notes_text text default '',
  lines jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  write_off_id uuid;
  line record;
  normalized_lines jsonb := '[]'::jsonb;
  line_count integer := 0;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректный список позиций.';
  end if;

  if doc_write_off_date is null then
    raise exception 'Укажите дату списания.';
  end if;

  for line in
    select *
    from jsonb_to_recordset(coalesce(lines, '[]'::jsonb)) as x(
      item_id uuid,
      quantity numeric
    )
  loop
    if line.item_id is null then
      raise exception 'В строке списания не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция списания не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 or line.quantity <> trunc(line.quantity) then
      raise exception 'Количество в списании должно быть целым числом больше нуля.';
    end if;

    normalized_lines := normalized_lines || jsonb_build_array(
      jsonb_build_object(
        'item_id', line.item_id,
        'quantity', line.quantity
      )
    );
    line_count := line_count + 1;
  end loop;

  if target_write_off_id is null then
    insert into public.inventory_write_offs (
      write_off_date, reason, notes, created_by, status, draft_lines
    )
    values (
      doc_write_off_date,
      btrim(coalesce(reason_text, '')),
      btrim(coalesce(notes_text, '')),
      auth.uid(),
      'draft',
      normalized_lines
    )
    returning id into write_off_id;
  else
    update public.inventory_write_offs
    set write_off_date = doc_write_off_date,
        reason = btrim(coalesce(reason_text, '')),
        notes = btrim(coalesce(notes_text, '')),
        draft_lines = normalized_lines
    where id = target_write_off_id
      and status = 'draft'
      and hidden_at is null
    returning id into write_off_id;

    if write_off_id is null then
      raise exception 'Черновик списания не найден.';
    end if;
  end if;

  perform public.record_audit(
    'inventory.write_off_draft_saved',
    'inventory_write_off',
    write_off_id::text,
    jsonb_build_object('reason', btrim(coalesce(reason_text, '')), 'lines', line_count)
  );

  return write_off_id;
end;
$$;

drop function if exists public.create_inventory_write_off(date, text, text, jsonb);

create or replace function public.create_inventory_write_off(
  doc_write_off_date date,
  reason_text text,
  notes_text text,
  lines jsonb,
  draft_write_off_id uuid default null
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
  source_lines jsonb;
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

  source_lines := coalesce(lines, '[]'::jsonb);
  if jsonb_typeof(source_lines) <> 'array' or jsonb_array_length(source_lines) = 0 then
    raise exception 'Добавьте хотя бы одну позицию списания.';
  end if;

  if draft_write_off_id is not null then
    update public.inventory_write_offs
    set write_off_date = doc_write_off_date,
        reason = btrim(reason_text),
        notes = btrim(coalesce(notes_text, '')),
        draft_lines = '[]'::jsonb,
        status = 'posted'
    where id = draft_write_off_id
      and status = 'draft'
      and hidden_at is null
    returning id into write_off_id;

    if write_off_id is null then
      raise exception 'Черновик списания не найден.';
    end if;
  else
    insert into public.inventory_write_offs (
      write_off_date, reason, notes, created_by, status, draft_lines
    )
    values (
      doc_write_off_date,
      btrim(reason_text),
      btrim(coalesce(notes_text, '')),
      auth.uid(),
      'posted',
      '[]'::jsonb
    )
    returning id into write_off_id;
  end if;

  for line in
    select *
    from jsonb_to_recordset(source_lines) as x(
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

drop function if exists public.list_inventory_write_offs(integer, integer);
drop function if exists public.list_inventory_write_offs(integer, integer, text, text);
drop function if exists public.list_inventory_write_offs(integer, integer, text, text, text);

create or replace function public.list_inventory_write_offs(
  page_number integer default 1,
  page_size integer default 20,
  sort_by text default 'created',
  sort_dir text default 'desc',
  status_filter text default 'all'
)
returns table (
  id uuid,
  write_off_date date,
  reason text,
  notes text,
  status text,
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
  sort_col text;
  sort_asc boolean;
  status_value text;
begin
  if not (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для просмотра списаний.';
  end if;

  status_value := coalesce(nullif(btrim(status_filter), ''), 'all');
  if status_value not in ('all', 'draft', 'posted') then
    raise exception 'Неизвестный фильтр статуса.';
  end if;

  sort_col := lower(coalesce(nullif(btrim(sort_by), ''), 'created'));
  if sort_col not in ('date', 'status', 'reason', 'lines', 'qty', 'amount', 'actor', 'created') then
    sort_col := 'created';
  end if;
  sort_asc := lower(coalesce(nullif(btrim(sort_dir), ''), 'desc')) = 'asc';

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    w.id,
    w.write_off_date,
    w.reason,
    w.notes,
    w.status,
    w.created_at,
    coalesce(p.full_name, '') as actor_name,
    case
      when w.status = 'draft' then coalesce(jsonb_array_length(w.draft_lines), 0)::bigint
      else count(distinct m.item_id)
    end as line_count,
    case
      when w.status = 'draft' then coalesce((
        select sum((line_row.elem ->> 'quantity')::numeric)
        from jsonb_array_elements(w.draft_lines) as line_row(elem)
      ), 0)
      else coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0)
    end as total_quantity,
    case
      when w.status = 'draft' then coalesce((
        select sum((line_row.elem ->> 'quantity')::numeric * i.purchase_price)
        from jsonb_array_elements(w.draft_lines) as line_row(elem)
        join public.inventory_items i on i.id = (line_row.elem ->> 'item_id')::uuid
      ), 0)
      else coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0)
    end as total_amount,
    count(*) over() as total_count
  from public.inventory_write_offs w
  left join public.profiles p on p.id = w.created_by
  left join public.inventory_movements m
    on m.reference_type = 'inventory_write_off'
   and m.reference_id = w.id
   and m.movement_type = 'write_off'
   and w.status = 'posted'
  where w.hidden_at is null
    and w.reversed_at is null
    and (status_value = 'all' or w.status = status_value)
  group by w.id, w.write_off_date, w.reason, w.notes, w.status, w.draft_lines, w.created_at, p.full_name
  order by
    case when sort_col = 'created' and not sort_asc then case when w.status = 'draft' then 0 else 1 end end,
    case when sort_col = 'date' and sort_asc then w.write_off_date end asc nulls last,
    case when sort_col = 'date' and not sort_asc then w.write_off_date end desc nulls last,
    case when sort_col = 'status' and sort_asc then w.status end asc nulls last,
    case when sort_col = 'status' and not sort_asc then w.status end desc nulls last,
    case when sort_col = 'reason' and sort_asc then w.reason end asc nulls last,
    case when sort_col = 'reason' and not sort_asc then w.reason end desc nulls last,
    case when sort_col = 'lines' and sort_asc then
      case
        when w.status = 'draft' then coalesce(jsonb_array_length(w.draft_lines), 0)::bigint
        else count(distinct m.item_id)
      end
    end asc nulls last,
    case when sort_col = 'lines' and not sort_asc then
      case
        when w.status = 'draft' then coalesce(jsonb_array_length(w.draft_lines), 0)::bigint
        else count(distinct m.item_id)
      end
    end desc nulls last,
    case when sort_col = 'qty' and sort_asc then
      case
        when w.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric)
          from jsonb_array_elements(w.draft_lines) as line_row(elem)
        ), 0)
        else coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0)
      end
    end asc nulls last,
    case when sort_col = 'qty' and not sort_asc then
      case
        when w.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric)
          from jsonb_array_elements(w.draft_lines) as line_row(elem)
        ), 0)
        else coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0)
      end
    end desc nulls last,
    case when sort_col = 'amount' and sort_asc then
      case
        when w.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric * i.purchase_price)
          from jsonb_array_elements(w.draft_lines) as line_row(elem)
          join public.inventory_items i on i.id = (line_row.elem ->> 'item_id')::uuid
        ), 0)
        else coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0)
      end
    end asc nulls last,
    case when sort_col = 'amount' and not sort_asc then
      case
        when w.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric * i.purchase_price)
          from jsonb_array_elements(w.draft_lines) as line_row(elem)
          join public.inventory_items i on i.id = (line_row.elem ->> 'item_id')::uuid
        ), 0)
        else coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0)
      end
    end desc nulls last,
    case when sort_col = 'actor' and sort_asc then coalesce(p.full_name, '') end asc nulls last,
    case when sort_col = 'actor' and not sort_asc then coalesce(p.full_name, '') end desc nulls last,
    case when sort_col = 'created' and sort_asc then w.created_at end asc nulls last,
    case when sort_col = 'created' and not sort_asc then w.created_at end desc nulls last,
    w.created_at desc
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
  header jsonb;
  write_off_status text;
  write_off_draft_lines jsonb;
begin
  if not (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для просмотра списания.';
  end if;

  select
    jsonb_build_object(
      'id', w.id,
      'write_off_date', w.write_off_date,
      'reason', w.reason,
      'notes', w.notes,
      'status', w.status,
      'created_at', w.created_at,
      'actor_name', coalesce(p.full_name, ''),
      'reversed_at', w.reversed_at
    ),
    w.status,
    w.draft_lines
  into header, write_off_status, write_off_draft_lines
  from public.inventory_write_offs w
  left join public.profiles p on p.id = w.created_by
  where w.id = target_write_off_id
    and w.hidden_at is null;

  if header is null then
    raise exception 'Списание не найдено.';
  end if;

  if write_off_status = 'draft' then
    return header || jsonb_build_object(
      'lines', coalesce((
        select jsonb_agg(row_to_json(x)::jsonb order by x.sort_order)
        from (
          select
            'draft-' || ordinality::text as id,
            (elem ->> 'item_id')::uuid as item_id,
            i.name as item_name,
            i.code as item_code,
            i.article as item_article,
            i.barcode as item_barcode,
            i.category_id,
            coalesce(cat.name, '') as category_name,
            i.unit_id,
            coalesce(u.name, '') as unit_name,
            i.purchase_price as item_purchase_price,
            i.repair_price,
            i.retail_price,
            coalesce((
              select sum(b.remaining_quantity)
              from public.inventory_batches b
              where b.item_id = i.id
            ), 0) as stock_quantity,
            i.created_at as item_created_at,
            i.updated_at as item_updated_at,
            (elem ->> 'quantity')::numeric as quantity,
            i.purchase_price as unit_price,
            (elem ->> 'quantity')::numeric * i.purchase_price as amount,
            ordinality as sort_order
          from jsonb_array_elements(coalesce(write_off_draft_lines, '[]'::jsonb))
            with ordinality as draft(elem, ordinality)
          join public.inventory_items i on i.id = (elem ->> 'item_id')::uuid
          left join public.reference_items cat on cat.id = i.category_id
          left join public.reference_items u on u.id = i.unit_id
        ) x
      ), '[]'::jsonb)
    );
  end if;

  return header || jsonb_build_object(
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
  );
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

  if current_row.status = 'draft' then
    delete from public.inventory_write_offs where id = target_write_off_id;

    perform public.record_audit(
      'inventory.write_off_draft_deleted',
      'inventory_write_off',
      target_write_off_id::text,
      jsonb_build_object('reason', current_row.reason)
    );
    return;
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

revoke all on function public.save_inventory_write_off_draft(uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.save_inventory_write_off_draft(uuid, date, text, text, jsonb) to authenticated;

revoke all on function public.create_inventory_write_off(date, text, text, jsonb, uuid) from public, anon;
grant execute on function public.create_inventory_write_off(date, text, text, jsonb, uuid) to authenticated;

revoke all on function public.list_inventory_write_offs(integer, integer, text, text, text) from public, anon;
grant execute on function public.list_inventory_write_offs(integer, integer, text, text, text) to authenticated;

revoke all on function public.get_inventory_write_off(uuid) from public, anon;
grant execute on function public.get_inventory_write_off(uuid) to authenticated;

revoke all on function public.delete_inventory_write_off(uuid, text) from public, anon;
grant execute on function public.delete_inventory_write_off(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [56/60 | was 147/151] 20261026150000_order_journal_status_codes.sql
-- -----------------------------------------------------------------------------

-- В журнал смены статуса добавляем коды — для цветных бейджей в ленте событий.

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
      coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
        'from_name', coalesce(s.metadata ->> 'from_name', f.name),
        'to_name', coalesce(s.metadata ->> 'to_name', t.name),
        'from_code', f.code,
        'to_code', t.code,
        'from_status_id', s.from_status_id,
        'to_status_id', s.to_status_id
      ),
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

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [57/60 | was 148/151] 20261026150000_roles_crud.sql
-- -----------------------------------------------------------------------------

-- CRUD ролей: is_system, create_role / update_role / delete_role.

alter table public.roles
  add column if not exists is_system boolean not null default false;

update public.roles
set is_system = true
where code in (
  'manager',
  'diagnostic_engineer',
  'chief_engineer',
  'storekeeper',
  'director'
);

create unique index if not exists roles_name_lower_uidx
  on public.roles (lower(btrim(name)));

-- Генерация code из названия (кириллица → латиница, snake_case).
create or replace function public.slugify_role_code(raw_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  src text;
  result text;
begin
  src := lower(btrim(coalesce(raw_name, '')));
  src := replace(src, 'ё', 'e');
  src := replace(src, 'ж', 'zh');
  src := replace(src, 'х', 'h');
  src := replace(src, 'ц', 'c');
  src := replace(src, 'ч', 'ch');
  src := replace(src, 'ш', 'sh');
  src := replace(src, 'щ', 'sch');
  src := replace(src, 'ъ', '');
  src := replace(src, 'ь', '');
  src := replace(src, 'ю', 'yu');
  src := replace(src, 'я', 'ya');
  src := translate(src, 'абвгдезийклмнопрстуфыэ', 'abvgdeziyklmnoprstufye');
  result := regexp_replace(src, '[^a-z0-9]+', '_', 'g');
  result := regexp_replace(result, '^_+|_+$', '', 'g');
  result := regexp_replace(result, '_+', '_', 'g');

  if result = '' or result !~ '^[a-z]' then
    result := 'custom_' || coalesce(nullif(result, ''), 'role');
  end if;

  if length(result) > 60 then
    result := left(result, 60);
    result := regexp_replace(result, '_+$', '', 'g');
  end if;

  return result;
end;
$$;

create or replace function public.create_role(
  p_name text,
  p_description text default null,
  p_copy_from_role_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_name text;
  normalized_description text;
  base_code text;
  next_code text;
  suffix integer := 1;
  new_id uuid;
  source_code text;
begin
  if not public.has_permission('roles:update') or not public.has_role('director') then
    raise exception 'Создавать роли может только руководитель.';
  end if;

  normalized_name := btrim(coalesce(p_name, ''));
  if normalized_name = '' then
    raise exception 'Укажите название роли.';
  end if;

  if length(normalized_name) > 80 then
    raise exception 'Название роли слишком длинное.';
  end if;

  if exists (
    select 1 from public.roles r where lower(btrim(r.name)) = lower(normalized_name)
  ) then
    raise exception 'Роль с таким названием уже существует.';
  end if;

  normalized_description := nullif(btrim(coalesce(p_description, '')), '');

  base_code := public.slugify_role_code(normalized_name);
  if exists (select 1 from public.roles r where r.code = base_code and r.is_system) then
    base_code := 'custom_' || base_code;
    if length(base_code) > 60 then
      base_code := left(base_code, 60);
      base_code := regexp_replace(base_code, '_+$', '', 'g');
    end if;
  end if;

  next_code := base_code;
  while exists (select 1 from public.roles r where r.code = next_code) loop
    suffix := suffix + 1;
    next_code := left(base_code, greatest(1, 60 - length('_' || suffix::text))) || '_' || suffix::text;
  end loop;

  if p_copy_from_role_id is not null then
    select code into source_code from public.roles where id = p_copy_from_role_id;
    if source_code is null then
      raise exception 'Роль для копирования прав не найдена.';
    end if;
  end if;

  insert into public.roles (code, name, description, is_system)
  values (next_code, normalized_name, normalized_description, false)
  returning id into new_id;

  if p_copy_from_role_id is not null then
    insert into public.role_permissions (role_id, permission_id)
    select new_id, rp.permission_id
    from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
    where rp.role_id = p_copy_from_role_id
      and p.code <> 'roles:update';
  end if;

  perform public.record_audit(
    'roles.created',
    'role',
    new_id::text,
    jsonb_build_object(
      'code', next_code,
      'name', normalized_name,
      'copy_from_role_id', p_copy_from_role_id
    )
  );

  return new_id;
end;
$$;

create or replace function public.update_role(
  p_role_id uuid,
  p_name text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.roles%rowtype;
  normalized_name text;
  normalized_description text;
begin
  if not public.has_permission('roles:update') or not public.has_role('director') then
    raise exception 'Изменять роли может только руководитель.';
  end if;

  select * into current_row from public.roles where id = p_role_id;
  if current_row.id is null then
    raise exception 'Роль не найдена.';
  end if;

  normalized_name := btrim(coalesce(p_name, ''));
  if normalized_name = '' then
    raise exception 'Укажите название роли.';
  end if;

  if length(normalized_name) > 80 then
    raise exception 'Название роли слишком длинное.';
  end if;

  if exists (
    select 1
    from public.roles r
    where lower(btrim(r.name)) = lower(normalized_name)
      and r.id <> p_role_id
  ) then
    raise exception 'Роль с таким названием уже существует.';
  end if;

  normalized_description := nullif(btrim(coalesce(p_description, '')), '');

  update public.roles
  set
    name = normalized_name,
    description = normalized_description
  where id = p_role_id;

  perform public.record_audit(
    'roles.updated',
    'role',
    p_role_id::text,
    jsonb_build_object(
      'code', current_row.code,
      'previous_name', current_row.name,
      'name', normalized_name,
      'previous_description', current_row.description,
      'description', normalized_description
    )
  );
end;
$$;

create or replace function public.delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.roles%rowtype;
  users_count integer;
  invites_count integer;
begin
  if not public.has_permission('roles:update') or not public.has_role('director') then
    raise exception 'Удалять роли может только руководитель.';
  end if;

  select * into current_row from public.roles where id = p_role_id;
  if current_row.id is null then
    raise exception 'Роль не найдена.';
  end if;

  if current_row.is_system then
    raise exception 'Системную роль удалить нельзя.';
  end if;

  select count(*)::integer into users_count
  from public.user_roles
  where role_id = p_role_id;

  if users_count > 0 then
    raise exception 'Сначала назначьте сотрудникам другую роль.';
  end if;

  select count(*)::integer into invites_count
  from public.invitations
  where role_id = p_role_id
    and status = 'pending';

  if invites_count > 0 then
    raise exception 'Есть незавершённые приглашения с этой ролью. Отмените их или дождитесь принятия.';
  end if;

  if exists (select 1 from public.invitations where role_id = p_role_id) then
    raise exception 'Роль использовалась в приглашениях и не может быть удалена.';
  end if;

  delete from public.roles where id = p_role_id;

  perform public.record_audit(
    'roles.deleted',
    'role',
    p_role_id::text,
    jsonb_build_object(
      'code', current_row.code,
      'name', current_row.name
    )
  );
end;
$$;

drop function if exists public.get_assignable_roles();

create or replace function public.get_assignable_roles()
returns table (
  id uuid,
  code text,
  name text,
  description text,
  is_system boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.code, r.name, r.description, r.is_system
  from public.roles r
  where public.can_assign_role(r.id)
  order by r.name;
$$;

revoke all on function public.slugify_role_code(text) from public, anon, authenticated;
revoke all on function public.create_role(text, text, uuid) from public, anon, authenticated;
revoke all on function public.update_role(uuid, text, text) from public, anon, authenticated;
revoke all on function public.delete_role(uuid) from public, anon, authenticated;
revoke all on function public.get_assignable_roles() from public, anon, authenticated;

grant execute on function public.create_role(text, text, uuid) to authenticated;
grant execute on function public.update_role(uuid, text, text) to authenticated;
grant execute on function public.delete_role(uuid) to authenticated;
grant execute on function public.get_assignable_roles() to authenticated;

-- -----------------------------------------------------------------------------
-- [58/60 | was 149/151] 20261026160000_inventory_multi_token_search.sql
-- -----------------------------------------------------------------------------

-- Поиск номенклатуры: несколько фрагментов через пробел — все должны встретиться
-- (порядок и позиция в строке не важны). Пример: «2.0 pet» → есть и «2.0», и «pet».

create or replace function public.inventory_item_matches_search(
  p_name text,
  p_code text,
  p_article text,
  p_barcode text,
  search_query text
)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    nullif(btrim(coalesce(search_query, '')), '') is null
    or (
      select coalesce(
        bool_and(
          coalesce(p_name, '') ilike ('%' || e.tok || '%') escape '\'
          or coalesce(p_code, '') ilike ('%' || e.tok || '%') escape '\'
          or coalesce(p_article, '') ilike ('%' || e.tok || '%') escape '\'
          or coalesce(p_barcode, '') ilike ('%' || e.tok || '%') escape '\'
        ),
        true
      )
      from (
        select replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as tok
        from unnest(regexp_split_to_array(btrim(search_query), '\s+')) as t
        where t <> ''
      ) e
    );
$$;

revoke all on function public.inventory_item_matches_search(text, text, text, text, text) from public, anon;
grant execute on function public.inventory_item_matches_search(text, text, text, text, text) to authenticated;

-- OUT-тип мог отличаться (min_stock / cover) — replace без drop падает с 42P13
drop function if exists public.search_inventory_items(text, integer, integer, text, uuid);
drop function if exists public.search_inventory_items(text, integer, integer, text);
drop function if exists public.search_inventory_items(text, integer, integer);

create function public.search_inventory_items(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  stock_filter text default 'all',
  category_filter uuid default null
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
  min_stock numeric,
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
  if stock_value not in ('all', 'zero', 'in_stock', 'below_min') then
    raise exception 'Неизвестный фильтр остатка.';
  end if;

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
    i.min_stock,
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
  where public.inventory_item_matches_search(i.name, i.code, i.article, i.barcode, search_query)
    and (category_filter is null or i.category_id = category_filter)
    and (stock_value <> 'zero' or (coalesce(stock.qty, 0) <= 0 and i.is_permanent))
    and (stock_value <> 'in_stock' or coalesce(stock.qty, 0) > 0)
    and (
      stock_value <> 'below_min'
      or (i.min_stock > 0 and coalesce(stock.qty, 0) <= i.min_stock)
    )
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.search_inventory_items(text, integer, integer, text, uuid) from public, anon;
grant execute on function public.search_inventory_items(text, integer, integer, text, uuid) to authenticated;

drop function if exists public.export_inventory_stock_items(text, text, uuid);

create function public.export_inventory_stock_items(
  search_query text default '',
  stock_filter text default 'all',
  category_filter uuid default null
)
returns table (
  item_code text,
  item_article text,
  manufacturer_code text,
  item_barcode text,
  item_name text,
  category_name text,
  description text,
  stock_quantity numeric,
  ordered_quantity numeric,
  unit_code text,
  expires_at text,
  serial_numbers text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  stock_value text;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('orders:read')
    or public.has_permission('sales:read')
    or public.has_permission('sales:create')
  ) then
    raise exception 'Недостаточно прав для экспорта склада.';
  end if;

  stock_value := coalesce(nullif(btrim(stock_filter), ''), 'all');
  if stock_value not in ('all', 'zero', 'in_stock') then
    raise exception 'Неизвестный фильтр остатка.';
  end if;

  return query
  with stock as (
    select b.item_id, coalesce(sum(b.remaining_quantity), 0) as qty
    from public.inventory_batches b
    group by b.item_id
  )
  select
    coalesce(i.code, '') as item_code,
    coalesce(i.article, '') as item_article,
    ''::text as manufacturer_code,
    coalesce(i.barcode, '') as item_barcode,
    coalesce(i.name, '') as item_name,
    coalesce(cat.name, '') as category_name,
    coalesce(i.description, '') as description,
    coalesce(stock.qty, 0) as stock_quantity,
    0::numeric as ordered_quantity,
    coalesce(nullif(btrim(u.code), ''), 'pcs') as unit_code,
    ''::text as expires_at,
    ''::text as serial_numbers,
    coalesce(i.purchase_price, 0) as purchase_price,
    coalesce(i.repair_price, 0) as repair_price,
    coalesce(i.retail_price, 0) as retail_price
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where public.inventory_item_matches_search(i.name, i.code, i.article, i.barcode, search_query)
    and (category_filter is null or i.category_id = category_filter)
    and (stock_value <> 'zero' or (coalesce(stock.qty, 0) <= 0 and i.is_permanent))
    and (stock_value <> 'in_stock' or coalesce(stock.qty, 0) > 0)
  order by i.name
  limit 50000;
end;
$$;

revoke all on function public.export_inventory_stock_items(text, text, uuid) from public, anon;
grant execute on function public.export_inventory_stock_items(text, text, uuid) to authenticated;

drop function if exists public.list_inventory_count_lines(uuid, text, text, integer, integer);

create function public.list_inventory_count_lines(
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
    and public.inventory_item_matches_search(i.name, i.code, i.article, i.barcode, search_query)
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
-- [59/60 | was 150/151] 20261026170000_delete_reference_item_cascade_unused.sql
-- -----------------------------------------------------------------------------

-- Удаление вида/бренда/модели: дочерние записи справочника сами по себе
-- не блокируют удаление. Блокируем только реальные связи (приборы, склад, статусы).
-- Пустое поддерево удаляется каскадом (листья → корень).

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
      from public.devices
      where group_id = target_item_id
         or brand_id = target_item_id
         or model_id = target_item_id
         or modification_id = target_item_id
    ) +
    (
      select count(*)
      from public.inventory_items
      where category_id = target_item_id or unit_id = target_item_id
    ) +
    (
      select count(*)
      from public.order_status_transitions
      where from_status_id = target_item_id or to_status_id = target_item_id
    )
  )::integer;
$$;

create or replace function public.reference_item_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  -- Для UI/проверки: только внешние связи. Дочерние reference_items
  -- удаляются вместе с родителем, если у поддерева нет внешних ссылок.
  select public.reference_item_external_usage_count(target_item_id);
$$;

create or replace function public.delete_reference_item(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
  leaf_row public.reference_items%rowtype;
  subtree_usage integer;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Запись справочника не найдена.';
  end if;

  with recursive tree as (
    select id, 0 as depth
    from public.reference_items
    where id = target_id
    union all
    select child.id, tree.depth + 1
    from public.reference_items child
    join tree on child.parent_id = tree.id
  )
  select coalesce(sum(public.reference_item_external_usage_count(tree.id)), 0)::integer
  into subtree_usage
  from tree;

  if subtree_usage > 0 then
    raise exception 'Запись используется и не может быть удалена. Скройте её, чтобы не показывать в списках.';
  end if;

  -- Доп. поля карточки видов приборов на всём поддереве
  delete from public.dynamic_field_values
  where entity_code = 'devices'
    and record_id in (
      with recursive tree as (
        select id
        from public.reference_items
        where id = target_id
        union all
        select child.id
        from public.reference_items child
        join tree on child.parent_id = tree.id
      )
      select id from tree
    );

  -- Листья сначала: parent_id ON DELETE RESTRICT
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
    order by tree.depth desc
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

revoke all on function public.reference_item_external_usage_count(uuid) from public, anon;
grant execute on function public.reference_item_external_usage_count(uuid) to authenticated;
revoke all on function public.reference_item_usage_count(uuid) from public, anon;
grant execute on function public.reference_item_usage_count(uuid) to authenticated;
revoke all on function public.delete_reference_item(uuid) from public, anon;
grant execute on function public.delete_reference_item(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [60/60 | was 151/151] 20261029120000_order_attachments_allow_imported_mimes.sql
-- -----------------------------------------------------------------------------

-- Allow imported RoApp office/HEIC attachments in order-attachments storage.
-- Historical imports reference .doc/.docx/.xlsx/.heic/.zip that the original
-- photo/pdf allow-list rejected; keep size cap, drop MIME restriction.
update storage.buckets
set allowed_mime_types = null
where id = 'order-attachments';
