-- Поиск контактов с фильтром по типу: люди / организации.

drop function if exists public.search_customers(text, integer, integer, boolean);

create function public.search_customers(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  active_only boolean default false,
  kind_filter text default null
)
returns table (
  id uuid,
  kind text,
  name text,
  inn text,
  kpp text,
  ogrn text,
  phone text,
  email text,
  city text,
  contact_name text,
  notes text,
  is_active boolean,
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
  safe_kind text;
begin
  if not (
    public.has_permission('customers:read')
    or public.has_permission('orders:read')
    or public.has_permission('orders:create')
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  term := replace(replace(btrim(coalesce(search_query, '')), '%', ''), '_', '');
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);
  safe_kind := btrim(coalesce(kind_filter, ''));
  if safe_kind <> '' and safe_kind not in ('organization', 'individual') then
    raise exception 'Некорректный тип контакта.';
  end if;

  return query
  select
    c.id,
    c.kind,
    c.name,
    c.inn,
    c.kpp,
    c.ogrn,
    c.phone,
    c.email,
    c.city,
    c.contact_name,
    c.notes,
    c.is_active,
    c.created_at,
    c.updated_at,
    count(*) over() as total_count
  from public.customers c
  where (not active_only or c.is_active = true)
    and (safe_kind = '' or c.kind = safe_kind)
    and (
      term = ''
      or c.name ilike '%' || term || '%'
      or c.contact_name ilike '%' || term || '%'
      or c.phone ilike '%' || term || '%'
      or c.email ilike '%' || term || '%'
      or c.inn ilike '%' || term || '%'
      or c.kpp ilike '%' || term || '%'
      or c.ogrn ilike '%' || term || '%'
      or c.city ilike '%' || term || '%'
    )
  order by c.name, c.created_at
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.search_customers(text, integer, integer, boolean, text) from public, anon;
grant execute on function public.search_customers(text, integer, integer, boolean, text) to authenticated;

notify pgrst, 'reload schema';
