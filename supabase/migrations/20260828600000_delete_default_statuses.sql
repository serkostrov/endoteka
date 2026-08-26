-- Можно удалить любой статус, в том числе начальный и уже использованный.

update public.reference_items r
set is_system = false
from public.reference_sets s
where s.id = r.set_id
  and s.code = 'order_statuses'
  and r.is_system = true;

create or replace function public.delete_order_status(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
  replacement_id uuid;
  was_initial boolean := false;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Статус не найден.';
  end if;

  select coalesce(m.is_initial, false) into was_initial
  from public.order_status_meta m
  where m.status_id = target_id;

  select i.id
    into replacement_id
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id and s.code = 'order_statuses'
  where i.id <> target_id
    and i.is_active
  order by i.sort_order, i.name
  limit 1;

  if replacement_id is null
     and (
       exists (select 1 from public.orders where status_id = target_id)
       or exists (select 1 from public.order_status_events where to_status_id = target_id)
     )
  then
    raise exception 'Нельзя удалить последний статус, пока есть заказы.';
  end if;

  if replacement_id is not null then
    update public.orders
    set status_id = replacement_id
    where status_id = target_id;

    update public.order_status_events
    set to_status_id = replacement_id
    where to_status_id = target_id;

    if was_initial then
      update public.order_status_meta
      set is_initial = false
      where status_id <> replacement_id;

      update public.order_status_meta
      set is_initial = true
      where status_id = replacement_id;
    end if;
  end if;

  delete from public.order_status_transitions
  where from_status_id = target_id or to_status_id = target_id;
  delete from public.order_status_meta where status_id = target_id;
  delete from public.reference_items where id = target_id;

  perform public.record_audit(
    'orders.status_deleted',
    'order_status',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'name', current_row.name)
  );
end;
$$;
