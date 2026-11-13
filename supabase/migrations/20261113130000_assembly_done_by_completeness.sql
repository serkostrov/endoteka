-- Вкладка «Выполненные»: только полностью собранные (комплектность 100%).
-- «В процессе сборки»: комплектность < 100% среди заказов раздела сборки.

create or replace function public.list_order_assemblies(
  tab_filter text default 'active',
  search_query text default '',
  page_number integer default 1,
  page_size integer default 30
)
returns table (
  id uuid,
  number text,
  number_seq integer,
  customer_id uuid,
  customer_name text,
  device_id uuid,
  serial_number text,
  device_label text,
  device_brand text,
  device_model text,
  status_id uuid,
  status_code text,
  status_name text,
  created_at timestamptz,
  updated_at timestamptz,
  completeness_pct numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tab_value text := coalesce(nullif(btrim(tab_filter), ''), 'active');
  term text;
  safe_page integer;
  safe_size integer;
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав.';
  end if;

  if tab_value not in ('active', 'done') then
    raise exception 'Неизвестная вкладка сборки.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 30), 1), 100);

  return query
  select
    a.id,
    a.number,
    a.number_seq,
    a.customer_id,
    a.customer_name,
    a.device_id,
    a.serial_number,
    a.device_label,
    a.device_brand,
    a.device_model,
    a.status_id,
    a.status_code,
    a.status_name,
    a.created_at,
    a.updated_at,
    a.completeness_pct,
    count(*) over() as total_count
  from public.order_assembly_list_items a
  where (
      (tab_value = 'active' and a.completeness_pct < 100)
      or (tab_value = 'done' and a.completeness_pct >= 100)
    )
    and (
      btrim(coalesce(search_query, '')) = ''
      or a.number ilike term escape '\'
      or a.customer_name ilike term escape '\'
      or a.serial_number ilike term escape '\'
      or a.device_label ilike term escape '\'
    )
  order by a.number_seq desc, a.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.list_order_assemblies(text, text, integer, integer) from public, anon;
grant execute on function public.list_order_assemblies(text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
