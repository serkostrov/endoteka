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
