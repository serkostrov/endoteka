-- Журнал действий: разрешить до 100 записей на странице, как в остальных списках.

create or replace function public.list_audit_events(
  search_query text default '',
  actor_filter uuid default null,
  entity_type_filter text default '',
  action_filter text default '',
  from_date date default null,
  to_date date default null,
  page_number integer default 1,
  page_size integer default 50
)
returns table (
  id uuid,
  actor_id uuid,
  actor_name text,
  actor_email text,
  action text,
  entity_type text,
  entity_id text,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  escaped text;
  entity_value text;
  action_value text;
  safe_page integer;
  safe_size integer;
  from_ts timestamptz;
  to_ts timestamptz;
begin
  if not public.has_permission('audit:read') then
    raise exception 'Недостаточно прав для просмотра журнала.';
  end if;

  entity_value := nullif(btrim(coalesce(entity_type_filter, '')), '');
  action_value := nullif(btrim(coalesce(action_filter, '')), '');
  term := nullif(btrim(coalesce(search_query, '')), '');
  if term is not null then
    escaped := replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_');
    term := '%' || escaped || '%';
  end if;

  if from_date is not null then
    from_ts := from_date::timestamp at time zone 'Europe/Moscow';
  end if;
  if to_date is not null then
    to_ts := (to_date + 1)::timestamp at time zone 'Europe/Moscow';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 50), 1), 100);

  return query
  select
    e.id,
    e.actor_id,
    case
      when e.actor_id is null then 'Система'
      else coalesce(nullif(btrim(p.full_name), ''), p.email, 'Пользователь')
    end as actor_name,
    coalesce(p.email, '') as actor_email,
    e.action,
    e.entity_type,
    e.entity_id,
    e.metadata,
    e.ip_address,
    e.user_agent,
    e.created_at,
    count(*) over () as total_count
  from public.audit_events e
  left join public.profiles p on p.id = e.actor_id
  where (actor_filter is null or e.actor_id = actor_filter)
    and (entity_value is null or e.entity_type = entity_value)
    and (action_value is null or e.action = action_value)
    and (from_ts is null or e.created_at >= from_ts)
    and (to_ts is null or e.created_at < to_ts)
    and (
      term is null
      or e.action ilike term escape '\'
      or e.entity_type ilike term escape '\'
      or coalesce(e.entity_id, '') ilike term escape '\'
      or coalesce(p.full_name, '') ilike term escape '\'
      or coalesce(p.email, '') ilike term escape '\'
      or coalesce(e.ip_address, '') ilike term escape '\'
    )
  order by e.created_at desc, e.id desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;
