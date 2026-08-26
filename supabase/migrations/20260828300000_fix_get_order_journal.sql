-- Журнал заказа: убрать конфликт имён RETURNS TABLE (id, event_type, ...) с колонками запроса.

create or replace function public.get_order_journal(target_order_id uuid)
returns table (
  id uuid,
  event_type text,
  summary text,
  actor_id uuid,
  actor_name text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (public.has_permission('orders:read') or public.has_permission('diagnostics:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  return query
  select
    src.id,
    src.event_type,
    src.summary,
    src.actor_id,
    src.actor_name,
    src.payload,
    src.created_at
  from (
    select
      e.id,
      e.event_type,
      e.summary,
      e.actor_id,
      coalesce(p.full_name, p.email, '')::text as actor_name,
      e.payload,
      e.created_at
    from public.order_journal_events e
    left join public.profiles p on p.id = e.actor_id
    where e.order_id = target_order_id

    union all

    select
      s.id,
      'status_changed'::text,
      case
        when s.from_status_id is null then coalesce(s.metadata ->> 'to_name', t.name)
        else coalesce(s.metadata ->> 'from_name', f.name, '') || ' → ' || coalesce(s.metadata ->> 'to_name', t.name)
      end,
      s.actor_id,
      coalesce(ap.full_name, ap.email, '')::text,
      s.metadata,
      s.created_at
    from public.order_status_events s
    left join public.reference_items f on f.id = s.from_status_id
    left join public.reference_items t on t.id = s.to_status_id
    left join public.profiles ap on ap.id = s.actor_id
    where s.order_id = target_order_id
  ) as src
  order by src.created_at desc, src.id desc;
end;
$$;

revoke all on function public.get_order_journal(uuid) from public, anon;
grant execute on function public.get_order_journal(uuid) to authenticated;
