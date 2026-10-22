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
