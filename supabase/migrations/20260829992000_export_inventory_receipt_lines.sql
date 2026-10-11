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
