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
