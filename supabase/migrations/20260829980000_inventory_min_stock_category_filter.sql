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
