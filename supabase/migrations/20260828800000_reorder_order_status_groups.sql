-- Порядок групп статусов (колонок на доске) меняется перетаскиванием.

create or replace function public.reorder_order_status_groups(group_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  perform public.assert_settings_write();

  if group_ids is null or array_length(group_ids, 1) is null then
    raise exception 'Передайте порядок групп.';
  end if;

  select count(*) into expected_count from public.order_status_groups;

  select count(*) into matched_count
  from public.order_status_groups
  where id = any (group_ids);

  if expected_count <> array_length(group_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все группы.';
  end if;

  update public.order_status_groups g
  set sort_order = o.ord - 1
  from unnest(group_ids) with ordinality as o(id, ord)
  where g.id = o.id;

  perform public.record_audit(
    'orders.status_groups_reordered',
    'order_status_group',
    null,
    jsonb_build_object('count', expected_count)
  );
end;
$$;

revoke all on function public.reorder_order_status_groups(uuid[]) from public, anon;
grant execute on function public.reorder_order_status_groups(uuid[]) to authenticated;
