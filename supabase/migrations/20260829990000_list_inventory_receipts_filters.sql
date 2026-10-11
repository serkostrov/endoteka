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
