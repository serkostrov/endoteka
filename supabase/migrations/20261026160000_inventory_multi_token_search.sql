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
